/**
 * Bitbucket Cloud client — Basic Auth (email + API token), нативный fetch.
 *
 * Контракт (раздел 7 спеки):
 *  - Авторизация: HTTP Basic с username = Atlassian email и password = API token
 *  - Пагинация: pagelen=100, идём по `next` URL (абсолютному) до конца
 *  - Поля списка ограничены через ?fields=... — режет трафик и парсинг
 *  - kind = 'template' если repo.project.key начинается с 'TP', иначе 'project'
 *  - Кэш списка в electron-store с TTL 10 мин; refresh форсит обход кэша
 *  - Last commit грузим лениво (отдельным fetchLastCommit per slug),
 *    в list() не дёргаем — берём updated_on из самого репо
 *
 * @typedef {import('../../shared/types.js').Project} Project
 */

import Store from 'electron-store'
import { getConfig } from './config-store.js'
import { getSecret } from './secrets.js'

const API_BASE = 'https://api.bitbucket.org/2.0'
const TTL_MS = 10 * 60 * 1000
const LIST_FIELDS =
  'values.slug,values.name,values.description,values.links.clone,values.project.key,values.updated_on,next'

const cacheStore = new Store({
  name: 'bitbucket-cache',
  clearInvalidConfig: true
})

class BitbucketError extends Error {
  constructor(message, status, stage) {
    super(message)
    this.name = 'BitbucketError'
    this.status = status
    this.stage = stage
  }
}

/**
 * Собирает аутентифицированный клиент один раз на запрос (или серию).
 * Бросает с stage='config', если креды не настроены — UI распознаёт стадию.
 */
function buildClient() {
  const config = getConfig()
  const token = getSecret('bitbucketApiToken')
  const username = config.bitbucket.username
  const workspace = config.bitbucket.workspace

  if (!username || !token) {
    throw new BitbucketError(
      'Bitbucket credentials not configured. Open Settings to add username (Atlassian email) and API token.',
      0,
      'config'
    )
  }
  if (!workspace) {
    throw new BitbucketError(
      'Bitbucket workspace not set. Open Settings.',
      0,
      'config'
    )
  }

  const auth =
    'Basic ' + Buffer.from(`${username}:${token}`).toString('base64')

  /**
   * @param {string} pathOrUrl относительный путь от /2.0 или абсолютный URL
   *                           (для пагинации по next)
   */
  async function request(pathOrUrl) {
    const url = pathOrUrl.startsWith('http')
      ? pathOrUrl
      : `${API_BASE}${pathOrUrl}`

    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        Authorization: auth
      }
    })

    if (res.status === 429) {
      throw new BitbucketError(
        'Bitbucket rate limit exceeded (1000 req/hour per user). Wait a few minutes and retry.',
        429,
        'rate-limit'
      )
    }
    if (res.status === 401) {
      throw new BitbucketError(
        'Authentication failed (401). Check that the API token is valid and not revoked.',
        401,
        'auth'
      )
    }
    if (res.status === 403) {
      throw new BitbucketError(
        'Forbidden (403). Token is valid but lacks permissions for this resource.',
        403,
        'auth'
      )
    }
    if (res.status === 404) {
      throw new BitbucketError(
        'Not found (404). Workspace or repository does not exist, or you do not have access.',
        404,
        'not-found'
      )
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new BitbucketError(
        `Bitbucket API ${res.status}: ${body.slice(0, 200) || res.statusText}`,
        res.status,
        'http'
      )
    }
    return res.json()
  }

  return { request, workspace, username }
}

/**
 * Проверка коннекта. Бьём именно тот эндпоинт, который реально нужен
 * приложению — список репо воркспейса (pagelen=1, чтобы не качать всё).
 * /user и /workspaces/{ws} требуют отдельных scope'ов
 * (read:account, read:workspace:bitbucket), которые могут не быть у
 * токена с только read:repository:bitbucket — и тогда тест бы фейлил
 * там, где фактическое использование клиента работает. Это неверно.
 *
 * Identity (display name) и красивое имя workspace грузим best-effort
 * после успеха основного теста — их провал НЕ влияет на ok=true.
 *
 * @returns {Promise<{ok: true, user: any, workspace: any} | {ok: false, stage: string, message: string, detail?: string}>}
 */
export async function testConnection() {
  let client
  try {
    client = buildClient()
  } catch (e) {
    return { ok: false, stage: e.stage || 'config', message: e.message }
  }

  // Главный функциональный тест — то, что делает list()
  try {
    await client.request(
      `/repositories/${encodeURIComponent(client.workspace)}?pagelen=1&fields=values.slug,next`
    )
  } catch (e) {
    if (e.status === 401) {
      return {
        ok: false,
        stage: 'auth',
        message: 'Authentication failed (401). API token is invalid, revoked, or the email does not match the account.'
      }
    }
    if (e.status === 403) {
      return {
        ok: false,
        stage: 'workspace',
        message: `Cannot read repositories in workspace "${client.workspace}".`,
        detail:
          'Token is valid but lacks the required scope or you do not have access to this workspace. ' +
          'Required scope: read:repository:bitbucket.'
      }
    }
    if (e.status === 404) {
      return {
        ok: false,
        stage: 'workspace',
        message: `Workspace "${client.workspace}" not found.`,
        detail: 'Check the workspace slug in Settings.'
      }
    }
    return { ok: false, stage: e.stage || 'http', message: e.message }
  }

  // Best-effort identity — если scope read:account отсутствует,
  // /user отдаст 403; это нормально, мы уже подтвердили repo-доступ.
  let identity = { displayName: client.username }
  try {
    const user = await client.request('/user')
    identity = {
      accountId: user.account_id,
      displayName: user.display_name || user.username || client.username,
      username: user.username
    }
  } catch {
    // ignore
  }

  // Best-effort красивое имя workspace
  let workspace = { slug: client.workspace, name: client.workspace }
  try {
    const ws = await client.request(
      `/workspaces/${encodeURIComponent(client.workspace)}`
    )
    workspace = { slug: ws.slug, name: ws.name }
  } catch {
    // ignore
  }

  return { ok: true, user: identity, workspace }
}

/**
 * Полный обход репо воркспейса с пагинацией.
 * Возвращает массив Project в форме раздела 5 спеки —
 * local/db/runtime заполняются нулевыми значениями (enrich на следующих
 * чекпоинтах подтягивает реальные).
 *
 * @returns {Promise<Project[]>}
 */
export async function listRepositories() {
  const client = buildClient()
  const ws = encodeURIComponent(client.workspace)
  let url = `/repositories/${ws}?pagelen=100&fields=${encodeURIComponent(
    LIST_FIELDS
  )}`

  /** @type {any[]} */
  const all = []
  while (url) {
    const data = await client.request(url)
    if (Array.isArray(data.values)) all.push(...data.values)
    url = data.next || null
  }

  return all.map((repo) => toProjectShape(repo, client.workspace))
}

/**
 * Список проектов с in-process кэшем (electron-store, TTL 10 мин).
 *
 * @param {boolean} forceRefresh — кнопка ⟳ Refresh
 * @returns {Promise<Project[]>}
 */
export async function listProjects(forceRefresh = false) {
  const cached = cacheStore.get('repos')
  const cachedAt = cacheStore.get('reposCachedAt')

  if (
    !forceRefresh &&
    Array.isArray(cached) &&
    typeof cachedAt === 'number' &&
    Date.now() - cachedAt < TTL_MS
  ) {
    return cached
  }

  const fresh = await listRepositories()
  cacheStore.set('repos', fresh)
  cacheStore.set('reposCachedAt', Date.now())
  return fresh
}

/**
 * Последние N коммитов репо (по умолчанию 5). Грузим лениво
 * (по открытию Detail drawer), НЕ в составе list — чтобы не
 * делать 70+ доп. запросов на каждый рефреш и не упираться в
 * rate-limit.
 *
 * @param {string} slug
 * @param {number} [pagelen=5]
 * @returns {Promise<import('../../shared/types.js').BitbucketCommit[]>}
 */
export async function getCommits(slug, pagelen = 5) {
  if (!slug || typeof slug !== 'string') return []
  const client = buildClient()
  const fields = encodeURIComponent(
    'values.message,values.author,values.date,values.hash'
  )
  const path = `/repositories/${encodeURIComponent(
    client.workspace
  )}/${encodeURIComponent(slug)}/commits?pagelen=${pagelen}&fields=${fields}`

  let data
  try {
    data = await client.request(path)
  } catch (e) {
    if (e.status === 404 || e.status === 403) return []
    throw e
  }

  return (data.values || []).map((c) => ({
    message: typeof c.message === 'string' ? c.message : '',
    author:
      c.author?.user?.display_name || c.author?.raw || 'unknown',
    date: c.date || '',
    hash: c.hash || ''
  }))
}

/**
 * Тонкая обёртка getCommits(slug, 1)[0] для сохранения старого API.
 *
 * @param {string} slug
 * @returns {Promise<import('../../shared/types.js').BitbucketCommit | null>}
 */
export async function getLastCommit(slug) {
  if (!slug || typeof slug !== 'string') return null
  const client = buildClient()
  const fields = encodeURIComponent(
    'values.message,values.author,values.date,values.hash'
  )
  const path = `/repositories/${encodeURIComponent(
    client.workspace
  )}/${encodeURIComponent(slug)}/commits?pagelen=1&fields=${fields}`

  let data
  try {
    data = await client.request(path)
  } catch (e) {
    // 404 / 403 — не критично, в UI показываем «—» без эскалации
    if (e.status === 404 || e.status === 403) return null
    throw e
  }

  const c = data.values?.[0]
  if (!c) return null

  const author =
    c.author?.user?.display_name ||
    c.author?.raw ||
    'unknown'

  return {
    message: typeof c.message === 'string' ? c.message : '',
    author,
    date: c.date || '',
    hash: c.hash || ''
  }
}

function toProjectShape(repo, workspace) {
  const cloneUrl =
    (repo.links?.clone || []).find((c) => c.name === 'https')?.href || ''
  const projectKey = repo.project?.key || ''
  const slugLower = (repo.slug || '').toLowerCase()

  return {
    slug: repo.slug,
    name: repo.name,
    description: repo.description || '',
    kind: projectKey.startsWith('TP') ? 'template' : 'project',
    bitbucket: {
      url: `https://bitbucket.org/${workspace}/${repo.slug}`,
      cloneUrl,
      updatedOn: repo.updated_on || null,
      projectKey
    },
    local: {
      path: null,
      cloned: false,
      dirty: false,
      branch: null,
      lastPullAt: null,
      runnableSubpath: null
    },
    db: {
      name: slugLower,
      exists: false,
      sizeBytes: null,
      dumpPath: null
    },
    runtime: {
      running: false,
      pid: null,
      port: null,
      startedAt: null
    }
  }
}
