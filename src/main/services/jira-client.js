/**
 * Jira Cloud REST API client — Basic Auth (email + API token), нативный fetch.
 *
 * Архитектура зеркалит bitbucket-client.js:
 *  - buildClient() собирает auth + request на каждый вызов
 *  - все ошибки маппятся в JiraError с stage='auth'/'config'/'http'
 *  - mainline-эндпоинты возвращают денормализованные plain-объекты
 *    (renderer не парсит ADF / nested fields)
 *  - короткий electron-store кэш для projects (10 мин)
 *
 * REST roots:
 *   /rest/api/3/myself             — текущий юзер (для /tasks?assignee=currentUser)
 *   /rest/api/3/project/search     — все доступные проекты пагинированно
 *   /rest/api/3/search             — JQL-поиск issues
 *   /rest/api/3/issue/{key}        — деталь issue (с комментариями)
 *
 * Все эндпоинты требуют scope read:jira-work + read:jira-user (плюс read:me
 * для /myself).
 */

import Store from 'electron-store'
import { getConfig } from './config-store.js'
import { getSecret } from './secrets.js'

const PROJECTS_TTL_MS = 10 * 60 * 1000

const cacheStore = new Store({
  name: 'jira-cache',
  clearInvalidConfig: true
})

class JiraError extends Error {
  constructor(message, status, stage) {
    super(message)
    this.name = 'JiraError'
    this.status = status
    this.stage = stage
  }
}

/**
 * Собирает аутентифицированный клиент на запрос. Email можно
 * переопределить отдельно от Bitbucket; если jira.email пуст —
 * фолбэк на bitbucket.username (тот же Atlassian-аккаунт у
 * большинства пользователей).
 */
function buildClient() {
  const config = getConfig()
  const token = (getSecret('jiraApiToken') || '').trim()
  const email = (
    config.jira?.email ||
    config.bitbucket?.username ||
    ''
  ).trim()
  // Нормализуем host до origin: пользователи часто пастят полный
  // URL с путём (https://techgurus.atlassian.net/jira/for-you), что
  // сломает все запросы — мы бы били по SPA route'у вместо REST API.
  // URL парсер сводит это к https://techgurus.atlassian.net.
  let host = (config.jira?.host || '').trim()
  try {
    const u = new URL(host)
    host = u.origin
  } catch {
    // невалидный URL — оставляем как ввели, validation ниже скажет
  }
  host = host.replace(/\/+$/, '')

  if (!host) {
    throw new JiraError(
      'Jira host not configured. Open Settings → Atlassian → Jira and add the host URL (e.g. https://yourcompany.atlassian.net).',
      0,
      'config'
    )
  }
  if (!email || !token) {
    throw new JiraError(
      'Jira credentials not configured. Open Settings → Atlassian → Jira and add email and API token.',
      0,
      'config'
    )
  }

  // Atlassian отдаёт два формата API-токенов: классический (Basic
  // email:token) и scoped (Bearer token). Bitbucket принимает оба
  // через Basic, Jira же на новых scoped-токенах часто отдаёт 401
  // на Basic и требует Bearer. Поэтому пробуем Basic, при 401 —
  // пробуем Bearer тем же токеном; первый успешный сохраняется
  // на время этого client'а, чтобы не делать лишних round-trip'ов.
  const basicAuth =
    'Basic ' + Buffer.from(`${email}:${token}`).toString('base64')
  const bearerAuth = `Bearer ${token}`
  let preferredAuth = basicAuth

  /**
   * @param {string} pathOrUrl относительный путь от корня host или абсолютный URL
   * @param {{ asText?: boolean, method?: string, body?: any }} [opts]
   */
  async function request(pathOrUrl, opts = {}) {
    const url = pathOrUrl.startsWith('http')
      ? pathOrUrl
      : `${host}${pathOrUrl}`

    const accept = opts.asText ? 'text/plain, */*' : 'application/json'
    const method = opts.method || 'GET'
    const hasBody = opts.body != null
    const buildInit = (auth) => {
      const init = {
        method,
        headers: { Accept: accept, Authorization: auth }
      }
      if (hasBody) {
        init.headers['Content-Type'] = 'application/json'
        init.body =
          typeof opts.body === 'string'
            ? opts.body
            : JSON.stringify(opts.body)
      }
      return init
    }

    let res = await fetch(url, buildInit(preferredAuth))
    // Fallback: если Basic вернул 401, попробуем Bearer (или
    // наоборот). Помогает при scoped Atlassian-токенах, которые на
    // Jira REST API ходят только Bearer'ом.
    if (res.status === 401 && preferredAuth === basicAuth) {
      const retry = await fetch(url, buildInit(bearerAuth))
      if (retry.status !== 401) {
        preferredAuth = bearerAuth
        res = retry
      }
    } else if (res.status === 401 && preferredAuth === bearerAuth) {
      const retry = await fetch(url, buildInit(basicAuth))
      if (retry.status !== 401) {
        preferredAuth = basicAuth
        res = retry
      }
    }

    if (res.status === 429) {
      throw new JiraError(
        'Jira rate limit exceeded. Wait a few minutes and retry.',
        429,
        'rate-limit'
      )
    }
    if (res.status === 401) {
      throw new JiraError(
        'Authentication failed (401). Check that the Jira API token is valid and that the email matches the Atlassian account.',
        401,
        'auth'
      )
    }
    if (res.status === 403) {
      throw new JiraError(
        'Forbidden (403). Token is valid but the scope or project permissions are insufficient.',
        403,
        'auth'
      )
    }
    if (res.status === 404) {
      throw new JiraError(
        'Not found (404). Resource does not exist or you do not have access.',
        404,
        'not-found'
      )
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new JiraError(
        `Jira API ${res.status}: ${body.slice(0, 200) || res.statusText}`,
        res.status,
        'http'
      )
    }
    // 204 No Content (типично для PUT /assignee, POST /transitions) —
    // тело пустое, парсить .json() сломается. Возвращаем null.
    if (res.status === 204) return null
    if (opts.asText) return res.text()
    // Некоторые POST'ы возвращают пустое тело без 204 — guarding.
    const text = await res.text()
    if (!text) return null
    try {
      return JSON.parse(text)
    } catch {
      return text
    }
  }

  return { request, host, email }
}

/**
 * Проверка коннекта. Главный функциональный тест — /project/search,
 * это именно тот scope (read:jira-work / read:project:jira), который
 * нужен реально работающему приложению. Identity (display name через
 * /myself) грузим best-effort: на scoped-токенах /myself часто живёт
 * под отдельным scope (read:me / read:user:jira), которого у токена
 * может не быть — это не блокирует основные операции, поэтому такой
 * 403 не превращаем в ошибку connection'а, просто фолбэчим имя на
 * email из настроек.
 *
 * @returns {Promise<{ok: true, user: {accountId: string|null, displayName: string, email: string}, host: string} | {ok: false, stage: string, message: string, detail?: string}>}
 */
export async function testConnection() {
  let client
  try {
    client = buildClient()
  } catch (e) {
    return { ok: false, stage: e.stage || 'config', message: e.message }
  }

  // Primary check: то, что делают list-эндпоинты (projects + issues
  // через JQL). Если этот шаг прошёл — token действительно может
  // делать ту работу, ради которой мы интегрируемся.
  try {
    await client.request('/rest/api/3/project/search?maxResults=1')
  } catch (e) {
    if (e.status === 401) {
      return {
        ok: false,
        stage: 'auth',
        message: 'Authentication failed (401).',
        detail:
          `Tried Basic and Bearer auth against ${client.host} with email "${client.email}". ` +
          'Possible causes: ' +
          '(1) email does not match the Atlassian account that owns the token; ' +
          '(2) the token was revoked or expired; ' +
          '(3) the host points to a different Atlassian site. ' +
          'Recreate the token at id.atlassian.com if unsure.'
      }
    }
    if (e.status === 403) {
      return {
        ok: false,
        stage: 'scope',
        message: 'Authenticated, but cannot list projects.',
        detail:
          'Token is missing the Jira-work read scope. Recreate it with ' +
          'read:jira-work (or, for granular scopes, read:project:jira + ' +
          'read:issue:jira).'
      }
    }
    if (e.status === 404) {
      return {
        ok: false,
        stage: 'host',
        message: `Jira host not reachable. Check the URL: ${client.host}.`
      }
    }
    return { ok: false, stage: e.stage || 'http', message: e.message }
  }

  // Best-effort identity. /myself часто живёт под scope, отдельным
  // от read:jira-work — если токен его не имеет, это нормально:
  // UI просто покажет email вместо display name.
  let identity = {
    accountId: null,
    displayName: client.email,
    email: client.email
  }
  try {
    const me = await client.request('/rest/api/3/myself')
    identity = {
      accountId: me.accountId || null,
      displayName: me.displayName || me.emailAddress || client.email,
      email: me.emailAddress || client.email
    }
  } catch {
    // ignore — projects уже доступны, имя не критично
  }

  return { ok: true, user: identity, host: client.host }
}

/**
 * Полный обход доступных пользователю проектов. Возвращает
 * минимальный shape для маппинга slug→key и UI-селекторов.
 *
 * @returns {Promise<Array<{ id: string, key: string, name: string, projectTypeKey: string, archived: boolean }>>}
 */
async function listProjectsRaw() {
  const client = buildClient()
  let url = '/rest/api/3/project/search?maxResults=100&orderBy=name&fields=key,name,projectTypeKey,archived'

  /** @type {any[]} */
  const all = []
  let safetyHops = 50 // защита от зацикливания на сломанной пагинации
  while (url && safetyHops-- > 0) {
    const data = await client.request(url)
    if (Array.isArray(data.values)) {
      for (const p of data.values) {
        all.push({
          id: String(p.id || ''),
          key: p.key || '',
          name: p.name || '',
          projectTypeKey: p.projectTypeKey || '',
          archived: !!p.archived
        })
      }
    }
    if (data.isLast || !data.nextPage) break
    url = data.nextPage
  }
  return all
}

/**
 * Список проектов с TTL-кэшем (10 мин). Refresh через
 * forceRefresh=true (кнопка ⟳ или test connection).
 *
 * @param {boolean} [forceRefresh=false]
 */
export async function listProjects(forceRefresh = false) {
  const cached = cacheStore.get('projects')
  const cachedAt = cacheStore.get('projectsCachedAt')
  if (
    !forceRefresh &&
    Array.isArray(cached) &&
    typeof cachedAt === 'number' &&
    Date.now() - cachedAt < PROJECTS_TTL_MS
  ) {
    return cached
  }
  const fresh = await listProjectsRaw()
  cacheStore.set('projects', fresh)
  cacheStore.set('projectsCachedAt', Date.now())
  return fresh
}

// ADF (Atlassian Document Format) больше не плющим в plain text —
// renderer получает raw tree и сам рендерит узлы (links, lists,
// inlineCard и т.п.). См. AdfRenderer в renderer'е.

const ISSUE_FIELDS = [
  'summary',
  'status',
  'priority',
  'issuetype',
  'updated',
  'created',
  'duedate',
  'project',
  'assignee',
  'reporter',
  'labels'
].join(',')

function toIssueShape(it) {
  const f = it.fields || {}
  return {
    key: it.key || '',
    summary: f.summary || '',
    status: f.status?.name || 'Unknown',
    statusCategory: f.status?.statusCategory?.key || 'undefined',
    statusCategoryName: f.status?.statusCategory?.name || 'Unknown',
    priority: f.priority?.name || null,
    priorityIconUrl: f.priority?.iconUrl || null,
    issueType: f.issuetype?.name || 'Task',
    issueTypeIconUrl: f.issuetype?.iconUrl || null,
    project: {
      key: f.project?.key || '',
      name: f.project?.name || ''
    },
    assignee: f.assignee
      ? {
          accountId: f.assignee.accountId || '',
          displayName: f.assignee.displayName || ''
        }
      : null,
    reporter: f.reporter
      ? {
          accountId: f.reporter.accountId || '',
          displayName: f.reporter.displayName || ''
        }
      : null,
    updated: f.updated || '',
    created: f.created || '',
    duedate: f.duedate || null,
    labels: Array.isArray(f.labels) ? f.labels : []
  }
}

/**
 * JQL-поиск через новый /rest/api/3/search/jql endpoint. Atlassian
 * убрала старый /rest/api/3/search в апреле 2026 (CHANGE-2046):
 * теперь курсорная пагинация по nextPageToken вместо startAt, и
 * `total` сервер больше не отдаёт — для "approximate count" есть
 * отдельный endpoint, но для нашего UI достаточно длины первой
 * страницы.
 *
 * @param {string} jql
 * @param {{ maxResults?: number, nextPageToken?: string }} [opts]
 * @param {ReturnType<typeof buildClient>} [clientParam] — опционально
 *   передать уже созданный client (чтобы не терять кэш auth-схемы
 *   между resolve-шагом и собственно search'ем).
 */
async function searchIssues(jql, opts = {}, clientParam) {
  const client = clientParam || buildClient()
  const max = Math.min(opts.maxResults ?? 50, 100)
  const qs = new URLSearchParams({
    jql,
    maxResults: String(max),
    fields: ISSUE_FIELDS
  })
  if (opts.nextPageToken) qs.set('nextPageToken', opts.nextPageToken)
  const data = await client.request(
    `/rest/api/3/search/jql?${qs.toString()}`
  )
  const issues = (data.issues || []).map(toIssueShape)
  return {
    issues,
    // total из API больше не приходит — отдаём длину текущей страницы,
    // UI на этом счётчике никаких бизнес-решений не строит.
    total: issues.length,
    isLast: data.isLast !== false && !data.nextPageToken,
    nextPageToken: data.nextPageToken || null
  }
}

// Кэш accountId по email — резолв через /myself или /user/search
// делается один раз на сессию, потом подставляется напрямую в JQL.
let cachedAccountId = null
let cachedAccountIdFor = null

/**
 * Резолвит accountId текущего пользователя без зависимости от JQL
 * функции `currentUser()` — она ненадёжно работает на Atlassian
 * "API tokens with scopes" через Bearer auth, и query тогда
 * возвращает 0 вместо реальных тасков.
 *
 * Каскад из трёх API, в порядке надёжности:
 *
 *  1. https://api.atlassian.com/me — Atlassian Account API,
 *     product-agnostic. Использует scope read:me (один из тех,
 *     что мы заявляем обязательным). Возвращает account_id, который
 *     валиден везде в экосистеме Atlassian, включая Jira JQL.
 *     Этот endpoint живёт на отдельном host'е, поэтому fetch'им
 *     его напрямую, минуя client.request.
 *
 *  2. /rest/api/3/myself на Jira-host'е — нужен если read:me нет,
 *     но есть Jira-specific scope (read:jira-user / granular
 *     read:user:jira).
 *
 *  3. /rest/api/3/user/search?query=<email> — последний шанс через
 *     read:jira-user. /user/search может вернуть частичный мэтч,
 *     поэтому фильтруем по точному email и игнорим мусорные
 *     записи без accountId / без email (GDPR-mode).
 *
 * Если все три не вернули accountId — caller падает обратно на
 * currentUser() JQL и (если оно тоже не работает) показывает
 * пустой список.
 */
async function resolveCurrentAccountId(client) {
  if (cachedAccountId && cachedAccountIdFor === client.email) {
    return cachedAccountId
  }

  // Plan A: Atlassian Account API на api.atlassian.com.
  const token = (getSecret('jiraApiToken') || '').trim()
  if (token) {
    try {
      const res = await fetch('https://api.atlassian.com/me', {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`
        }
      })
      if (res.ok) {
        const data = await res.json().catch(() => null)
        if (data?.account_id) {
          cachedAccountId = data.account_id
          cachedAccountIdFor = client.email
          return cachedAccountId
        }
      }
    } catch {
      // ignore — пробуем Plan B
    }
  }

  // Plan B: Jira-specific /myself.
  try {
    const me = await client.request('/rest/api/3/myself')
    if (me?.accountId) {
      cachedAccountId = me.accountId
      cachedAccountIdFor = client.email
      return cachedAccountId
    }
  } catch {
    // ignore — пробуем Plan C
  }

  // Plan C: /user/search с email-фильтром.
  if (client.email) {
    try {
      const results = await client.request(
        `/rest/api/3/user/search?query=${encodeURIComponent(client.email)}`
      )
      if (Array.isArray(results)) {
        const exact = results.find(
          (u) =>
            u.emailAddress &&
            u.emailAddress.toLowerCase() === client.email.toLowerCase()
        )
        const pick = exact || results[0]
        if (pick?.accountId) {
          cachedAccountId = pick.accountId
          cachedAccountIdFor = client.email
          return cachedAccountId
        }
      }
    } catch {
      // ignore
    }
  }

  return null
}

/**
 * Свои незакрытые таски — по всем проектам, доступным юзеру.
 * Без project-фильтра в JQL: Jira сам ограничит результат
 * проектами, к которым у юзера есть доступ.
 *
 * Каскад фильтров (от точного к универсальному):
 *  1. assignee = "<accountId>"  — если успели резолвнуть accountId
 *     (через /myself или /user/search). Самый надёжный.
 *  2. assignee = currentUser()  — fallback, который работает не во
 *     всех конфигурациях scoped-токенов через Bearer auth. Но если
 *     первый вариант 4xx (e.g. accountId не подходит для этого
 *     пользователя по какой-то причине), пробуем хотя бы это.
 *
 * @param {{ maxResults?: number }} [opts]
 */
export async function getMyIssues(opts = {}) {
  const client = buildClient()
  const accountId = await resolveCurrentAccountId(client)
  const tail = ' AND statusCategory != Done ORDER BY updated DESC'
  const max = opts.maxResults ?? 50

  if (accountId) {
    try {
      return await searchIssues(
        `assignee = "${accountId}"${tail}`,
        { maxResults: max },
        client
      )
    } catch (e) {
      // 403/400 на этой JQL означают что либо accountId формат не
      // тот, либо scope не позволяет фильтровать по чужому. Падаем
      // обратно на currentUser() — будет либо empty (известный баг
      // currentUser() через Bearer), либо реальные таски.
      if (e.status !== 403 && e.status !== 400) throw e
    }
  }

  return searchIssues(
    `assignee = currentUser()${tail}`,
    { maxResults: max },
    client
  )
}

/**
 * Закрытые таски проекта (statusCategory = Done) — последние N
 * штук. Используется для секции "Recently done" в Tasks-табе,
 * чтобы пользователь видел свежий контекст того, что недавно
 * было сделано в проекте.
 *
 * @param {string} projectKey
 * @param {{ maxResults?: number }} [opts]
 */
export async function getProjectClosedIssues(projectKey, opts = {}) {
  if (!projectKey) return { issues: [], total: 0, isLast: true }
  const safe = projectKey.replace(/"/g, '\\"')
  return searchIssues(
    `project = "${safe}" AND statusCategory = Done ORDER BY updated DESC`,
    { maxResults: opts.maxResults ?? 10 }
  )
}

/**
 * Незакрытые таски одного Jira-проекта.
 *
 * @param {string} projectKey
 * @param {{ maxResults?: number }} [opts]
 */
export async function getProjectIssues(projectKey, opts = {}) {
  if (!projectKey) return { issues: [], total: 0, isLast: true }
  // Экранируем кавычки в JQL — теоретически project-keys только
  // alnum, но защититься от инъекции дешевле, чем отлаживать
  // потом потенциальный 400.
  const safe = projectKey.replace(/"/g, '\\"')
  return searchIssues(
    `project = "${safe}" AND statusCategory != Done ORDER BY updated DESC`,
    { maxResults: opts.maxResults ?? 50 }
  )
}

/**
 * Деталь одной задачи — summary + description (ADF→plain) +
 * последние 5 комментариев. Используется в Tasks-drawer'е.
 *
 * @param {string} issueKey
 */
export async function getIssueDetail(issueKey) {
  if (!issueKey) return null
  const client = buildClient()
  const fields = [ISSUE_FIELDS, 'description', 'comment'].join(',')
  let it
  try {
    it = await client.request(
      `/rest/api/3/issue/${encodeURIComponent(issueKey)}?fields=${encodeURIComponent(
        fields
      )}`
    )
  } catch (e) {
    if (e.status === 404 || e.status === 403) return null
    throw e
  }

  const base = toIssueShape(it)
  // description / comment.body — отдаём raw ADF tree (или null).
  // Renderer сам решает как его отрисовать (AdfRenderer); у нас в
  // main процессе нет нормального React-инструментария для рендера,
  // и хочется сохранить mark'и / inlineCard / mention.
  const description = it.fields?.description || null
  const comments = (it.fields?.comment?.comments || [])
    .slice(-5)
    .map((c) => ({
      id: String(c.id || ''),
      author: c.author?.displayName || 'unknown',
      body: c.body || null,
      created: c.created || ''
    }))

  return {
    ...base,
    description,
    comments,
    url: `${client.host}/browse/${base.key}`
  }
}

/**
 * Утилита для UI: даёт URL на view конкретной issue. Renderer
 * сам не знает host'а — он в config.
 */
export function buildIssueUrl(issueKey) {
  if (!issueKey) return ''
  const config = getConfig()
  const host = (config.jira?.host || '').replace(/\/+$/, '')
  if (!host) return ''
  return `${host}/browse/${encodeURIComponent(issueKey)}`
}

/**
 * Превращает plain string в минимальный валидный ADF document —
 * используется для POST /comment, где Jira принимает body только в
 * ADF-формате. Каждая строка превращается в отдельный paragraph;
 * пустые строки пропускаем.
 */
function plainToAdf(text) {
  const t = (text || '').toString()
  const lines = t.split(/\r?\n/)
  const content = []
  for (const line of lines) {
    if (!line) {
      content.push({ type: 'paragraph', content: [] })
      continue
    }
    content.push({
      type: 'paragraph',
      content: [{ type: 'text', text: line }]
    })
  }
  return { type: 'doc', version: 1, content }
}

/**
 * Добавить комментарий к issue. Принимаем plain string из UI и
 * автоматически конвертируем в ADF — пользователю не нужно знать
 * про Atlassian-формат.
 *
 * @param {string} issueKey
 * @param {string} bodyText
 */
export async function addComment(issueKey, bodyText) {
  if (!issueKey) throw new JiraError('issueKey required', 0, 'config')
  const trimmed = (bodyText || '').trim()
  if (!trimmed) throw new JiraError('Comment body is empty', 0, 'config')
  const client = buildClient()
  return client.request(
    `/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment`,
    {
      method: 'POST',
      body: { body: plainToAdf(trimmed) }
    }
  )
}

/**
 * Сменить assignee'а. accountId === null отвязывает (unassigned).
 *
 * @param {string} issueKey
 * @param {string|null} accountId
 */
export async function setAssignee(issueKey, accountId) {
  if (!issueKey) throw new JiraError('issueKey required', 0, 'config')
  const client = buildClient()
  return client.request(
    `/rest/api/3/issue/${encodeURIComponent(issueKey)}/assignee`,
    {
      method: 'PUT',
      body: { accountId: accountId || null }
    }
  )
}

/**
 * Список доступных переходов из текущего статуса. Возвращает
 * нормализованный shape: id, name, целевой статус.
 *
 * @param {string} issueKey
 */
export async function getTransitions(issueKey) {
  if (!issueKey) return []
  const client = buildClient()
  let data
  try {
    data = await client.request(
      `/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`
    )
  } catch (e) {
    if (e.status === 403 || e.status === 404) return []
    throw e
  }
  return (data?.transitions || []).map((t) => ({
    id: String(t.id),
    name: t.name || '',
    toStatus: t.to?.name || '',
    toStatusCategory: t.to?.statusCategory?.key || ''
  }))
}

/**
 * Применить переход (изменить статус). transitionId — id из
 * getTransitions. Сервер сам решает что показывать на screen'е,
 * мы не передаём fields.
 *
 * @param {string} issueKey
 * @param {string} transitionId
 */
export async function applyTransition(issueKey, transitionId) {
  if (!issueKey || !transitionId) {
    throw new JiraError('issueKey and transitionId required', 0, 'config')
  }
  const client = buildClient()
  return client.request(
    `/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`,
    {
      method: 'POST',
      body: { transition: { id: String(transitionId) } }
    }
  )
}

/**
 * Список пользователей, доступных для назначения на конкретную
 * задачу. Endpoint /user/assignable/search автоматически
 * фильтрует по project-permissions — в выдачу попадают только
 * те, кто реально может быть assignee этой issue (а не все
 * пользователи Atlassian-org'а).
 *
 * Без query (пустая строка) возвращает полный список —
 * пользователь сразу видит всех assignable юзеров. С query —
 * сервер фильтрует по имени/email на своей стороне.
 *
 * @param {string} issueKey
 * @param {string} [query]
 */
export async function searchAssignableUsers(issueKey, query) {
  if (!issueKey) return []
  const client = buildClient()
  const params = new URLSearchParams({
    issueKey,
    // 200 покрывает практически любой проект — assignable lists
    // редко бывают больше нескольких десятков людей.
    maxResults: '200'
  })
  const q = (query || '').trim()
  if (q) params.set('query', q)
  let data
  try {
    data = await client.request(
      `/rest/api/3/user/assignable/search?${params.toString()}`
    )
  } catch (e) {
    if (e.status === 403 || e.status === 404) return []
    throw e
  }
  return (Array.isArray(data) ? data : [])
    .filter((u) => u?.accountId)
    .map((u) => ({
      accountId: u.accountId,
      displayName: u.displayName || '',
      emailAddress: u.emailAddress || ''
    }))
}
