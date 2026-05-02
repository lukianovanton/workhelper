/**
 * Реализация VcsProvider для GitLab (Cloud + self-hosted).
 *
 * Auth: Personal Access Token. GitLab принимает оба варианта заголовков:
 *   - PRIVATE-TOKEN: <token>     (нативный для GitLab)
 *   - Authorization: Bearer ...  (OAuth-совместимый)
 * Используем PRIVATE-TOKEN — он работает и для personal-, и для group-
 * access-token'ов без дополнительных настроек.
 *
 * Workspace в нашей VcsSourceConfig для GitLab — это namespace: имя
 * группы или username. Listing пробует /groups/{ns}/projects, на 404
 * фолбэчится на /users/{ns}/projects (как у GitHub-провайдера для
 * org vs user различия).
 *
 * Self-hosted: base URL берётся из providerOptions.baseUrl, default
 * 'https://gitlab.com'. Все API-пути относительно `${baseUrl}/api/v4`.
 *
 * Pipelines у GitLab более прямолинейны, чем у GitHub Actions:
 *   builds      ↔ pipelines        (/projects/{id}/pipelines)
 *   buildSteps  ↔ jobs of pipeline (/pipelines/{pid}/jobs)
 *   stepLog     ↔ job trace        (/jobs/{jid}/trace) — plain-text лог
 *
 * @typedef {import('./types.js').VcsProvider} VcsProvider
 * @typedef {import('./types.js').ProviderRepo} ProviderRepo
 */

import Store from 'electron-store'

const TTL_MS = 10 * 60 * 1000
const COMMIT_DETAIL_TTL_MS = 5 * 60 * 1000

class GitLabError extends Error {
  constructor(message, status, stage) {
    super(message)
    this.name = 'GitLabError'
    this.status = status
    this.stage = stage
  }
}

/**
 * @param {Object} opts
 * @param {() => string} opts.getWorkspace      lazy: GitLab namespace
 *                                                (group full-path или username)
 * @param {() => string} opts.getUsername       lazy: login для clone-URL
 * @param {() => string|null} opts.getToken     lazy: PAT
 * @param {string} opts.cacheKey                имя electron-store файла
 * @param {() => string} [opts.getBaseUrl]      lazy: base URL инстанса.
 *                                                Default 'https://gitlab.com'.
 *                                                Для self-hosted указать
 *                                                в providerOptions.baseUrl.
 * @returns {VcsProvider}
 */
export function createGitLabProvider({
  getWorkspace,
  getUsername,
  getToken,
  cacheKey,
  getBaseUrl
}) {
  const cacheStore = new Store({
    name: cacheKey,
    clearInvalidConfig: true
  })

  /** @type {Map<string, {detail: any, ts: number}>} */
  const commitDetailMemo = new Map()

  function resolveBaseUrl() {
    const raw = (getBaseUrl && getBaseUrl()) || 'https://gitlab.com'
    // Зачищаем trailing slash чтобы конкатенация дала корректные URL.
    return raw.replace(/\/+$/, '')
  }

  function buildClient() {
    const token = getToken()
    const workspace = getWorkspace()
    const baseUrl = resolveBaseUrl()
    const apiBase = `${baseUrl}/api/v4`

    if (!token) {
      throw new GitLabError(
        'GitLab token not configured. Open Settings to add a Personal Access Token.',
        0,
        'config'
      )
    }
    if (!workspace) {
      throw new GitLabError(
        'GitLab namespace (group or username) not set. Open Settings.',
        0,
        'config'
      )
    }

    async function request(pathOrUrl, opts = {}) {
      const url = pathOrUrl.startsWith('http')
        ? pathOrUrl
        : `${apiBase}${pathOrUrl}`

      const accept = opts.asText
        ? 'text/plain, */*'
        : 'application/json'

      const res = await fetch(url, {
        headers: {
          Accept: accept,
          'PRIVATE-TOKEN': token,
          'User-Agent': 'WorkHelper'
        }
      })

      if (res.status === 401) {
        throw new GitLabError(
          'Authentication failed (401). Check that the GitLab token is valid and not revoked.',
          401,
          'auth'
        )
      }
      if (res.status === 403) {
        // GitLab также отдаёт 403 при rate-limit'е и при недостатке scope'а.
        const remaining = res.headers.get('ratelimit-remaining')
        if (remaining === '0') {
          throw new GitLabError(
            'GitLab rate limit exceeded. Wait until the limit resets and retry.',
            403,
            'rate-limit'
          )
        }
        throw new GitLabError(
          'Forbidden (403). Token is valid but lacks permissions or required scope (read_api / read_repository).',
          403,
          'auth'
        )
      }
      if (res.status === 404) {
        throw new GitLabError(
          'Not found (404). Namespace or repository does not exist, or you do not have access.',
          404,
          'not-found'
        )
      }
      if (res.status === 429) {
        throw new GitLabError(
          'GitLab rate limit (secondary) exceeded. Slow down and retry in a minute.',
          429,
          'rate-limit'
        )
      }
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        throw new GitLabError(
          `GitLab API ${res.status}: ${body.slice(0, 200) || res.statusText}`,
          res.status,
          'http'
        )
      }
      if (opts.asText) return res.text()
      return res.json()
    }

    return { request, workspace, baseUrl, apiBase }
  }

  /**
   * GitLab API использует URL-encoded `namespace/path` как project ID
   * везде. Slug в нашей семантике = последний сегмент (path), workspace =
   * namespace. Собирает encoded ID для slug'а.
   */
  function projectIdFor(client, slug) {
    return encodeURIComponent(`${client.workspace}/${slug}`)
  }

  async function testConnection() {
    let client
    try {
      client = buildClient()
    } catch (e) {
      return { ok: false, stage: e.stage || 'config', message: e.message }
    }

    let user
    try {
      user = await client.request('/user')
    } catch (e) {
      if (e.status === 401) {
        return {
          ok: false,
          stage: 'auth',
          message: 'Authentication failed (401). PAT is invalid or revoked.'
        }
      }
      return { ok: false, stage: e.stage || 'http', message: e.message }
    }

    // Проверяем что namespace существует. Сначала пробуем как group,
    // на 404 пробуем как user. Совпадает с listRepos-логикой ниже.
    let workspace = { slug: client.workspace, name: client.workspace }
    try {
      const group = await client.request(
        `/groups/${encodeURIComponent(client.workspace)}`
      )
      workspace = {
        slug: group.full_path || group.path || client.workspace,
        name: group.name || group.full_name || client.workspace,
        type: 'Group'
      }
    } catch (e) {
      if (e.status !== 404) {
        return {
          ok: false,
          stage: 'workspace',
          message: `Could not access namespace "${client.workspace}": ${e.message}`
        }
      }
      // Group не нашёлся — пробуем user.
      try {
        const list = await client.request(
          `/users?username=${encodeURIComponent(client.workspace)}`
        )
        const u = Array.isArray(list) ? list[0] : null
        if (u) {
          workspace = {
            slug: u.username || client.workspace,
            name: u.name || u.username || client.workspace,
            type: 'User'
          }
        }
      } catch {
        // ignore — приватный профиль или ещё чего
      }
    }

    return {
      ok: true,
      user: {
        accountId: String(user.id),
        displayName: user.name || user.username,
        username: user.username
      },
      workspace
    }
  }

  async function listAllRepos() {
    const client = buildClient()
    const ns = encodeURIComponent(client.workspace)

    /** @type {any[]} */
    const all = []
    // Group endpoint поддерживает include_subgroups, но мы намеренно
    // оставляем false: одна source = один namespace. Для subgroup'ов
    // юзер добавляет отдельный source. Это совпадает с моделью BB
    // (один workspace = один source).
    let url = `/groups/${ns}/projects?per_page=100&order_by=updated_at&sort=desc`
    let isGroupEndpoint = true
    let page = 1

    while (url) {
      try {
        const data = await client.request(url)
        if (Array.isArray(data) && data.length > 0) {
          all.push(...data)
          if (data.length < 100) {
            url = null
          } else {
            page += 1
            url = isGroupEndpoint
              ? `/groups/${ns}/projects?per_page=100&order_by=updated_at&sort=desc&page=${page}`
              : `/users/${ns}/projects?per_page=100&order_by=updated_at&sort=desc&page=${page}`
          }
        } else {
          url = null
        }
      } catch (e) {
        if (e.status === 404 && isGroupEndpoint) {
          // Это user, не group. Перезапускаем с user-эндпоинта.
          all.length = 0
          isGroupEndpoint = false
          page = 1
          url = `/users/${ns}/projects?per_page=100&order_by=updated_at&sort=desc`
          continue
        }
        throw e
      }
    }

    return all.map(toProviderRepo)
  }

  async function listRepos(forceRefresh = false) {
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

    const fresh = await listAllRepos()
    cacheStore.set('repos', fresh)
    cacheStore.set('reposCachedAt', Date.now())
    return fresh
  }

  async function getRepo(slug) {
    if (!slug || typeof slug !== 'string') return null
    const client = buildClient()
    try {
      const repo = await client.request(`/projects/${projectIdFor(client, slug)}`)
      return toProviderRepo(repo)
    } catch (e) {
      if (e.status === 404 || e.status === 403) return null
      throw e
    }
  }

  async function getCommits(slug, opts = {}) {
    if (!slug || typeof slug !== 'string') return []
    const o = typeof opts === 'number' ? { pagelen: opts } : opts || {}
    const pagelen = o.pagelen ?? 30
    const branch = o.branch || null
    const client = buildClient()
    const id = projectIdFor(client, slug)

    let url = `/projects/${id}/repository/commits?per_page=${pagelen}`
    if (branch) url += `&ref_name=${encodeURIComponent(branch)}`

    let data
    try {
      data = await client.request(url)
    } catch (e) {
      if (e.status === 404 || e.status === 403) return []
      throw e
    }
    return (Array.isArray(data) ? data : []).map(toCommitShape)
  }

  async function getCommitDetailRaw(slug, hash) {
    const cacheKey = `${slug}:${hash}`
    const cached = commitDetailMemo.get(cacheKey)
    if (cached && Date.now() - cached.ts < COMMIT_DETAIL_TTL_MS) {
      return cached.detail
    }
    const client = buildClient()
    const id = projectIdFor(client, slug)
    const h = encodeURIComponent(hash)
    let detail, diff
    try {
      // GitLab делит commit на header + diff отдельным эндпоинтом.
      // Параллелим — оба нужны для нашего CommitDetail-shape'а.
      ;[detail, diff] = await Promise.all([
        client.request(`/projects/${id}/repository/commits/${h}`),
        client
          .request(`/projects/${id}/repository/commits/${h}/diff`)
          .catch(() => [])
      ])
    } catch (e) {
      if (e.status === 404 || e.status === 403) return null
      throw e
    }
    const merged = { ...detail, _diff: Array.isArray(diff) ? diff : [] }
    commitDetailMemo.set(cacheKey, { detail: merged, ts: Date.now() })
    return merged
  }

  async function getCommitDetail(slug, hash) {
    if (!slug || !hash) return null
    const detail = await getCommitDetailRaw(slug, hash)
    if (!detail) return null
    const client = buildClient()

    const files = (detail._diff || []).map((f) => ({
      status: mapFileStatus(f),
      // GitLab возвращает только diff-text и пути, без точного
      // additions/deletions per file. Подсчитываем линии «+ / -» из
      // патча — простой счёт совместим с UI.
      linesAdded: countDiffLines(f.diff, '+'),
      linesRemoved: countDiffLines(f.diff, '-'),
      path: f.new_path || f.old_path || '(unknown)'
    }))

    const stats = detail.stats || {}
    const diffstat = {
      filesChanged: files.length,
      linesAdded: stats.additions ?? files.reduce((a, f) => a + f.linesAdded, 0),
      linesRemoved:
        stats.deletions ?? files.reduce((a, f) => a + f.linesRemoved, 0),
      files,
      truncated: false
    }

    const baseUrl = client.baseUrl
    return {
      hash: detail.id || hash,
      message: typeof detail.message === 'string' ? detail.message : '',
      date: detail.committed_date || detail.authored_date || '',
      author:
        detail.author_name ||
        detail.committer_name ||
        'unknown',
      authorAccountId: null, // GitLab commit-detail не отдаёт user id'а
      parents: Array.isArray(detail.parent_ids) ? detail.parent_ids : [],
      diffstat,
      url: `${baseUrl}/${client.workspace}/${slug}/-/commit/${detail.id || hash}`
    }
  }

  async function getCommitFileDiff(slug, hash, path) {
    if (!slug || !hash || !path) return ''
    const detail = await getCommitDetailRaw(slug, hash)
    if (!detail) return ''
    const file = (detail._diff || []).find(
      (f) => f.new_path === path || f.old_path === path
    )
    return file?.diff || ''
  }

  async function getBranches(slug) {
    if (!slug || typeof slug !== 'string') {
      return { defaultBranch: null, branches: [] }
    }
    const client = buildClient()
    const id = projectIdFor(client, slug)

    const branchesPromise = (async () => {
      /** @type {string[]} */
      const out = []
      let page = 1
      while (true) {
        let data
        try {
          data = await client.request(
            `/projects/${id}/repository/branches?per_page=100&page=${page}`
          )
        } catch (e) {
          if (e.status === 404 || e.status === 403) break
          throw e
        }
        if (!Array.isArray(data) || data.length === 0) break
        for (const b of data) if (b?.name) out.push(b.name)
        if (data.length < 100) break
        page += 1
      }
      return out
    })()

    const defaultPromise = (async () => {
      try {
        const repo = await client.request(`/projects/${id}`)
        return repo?.default_branch || null
      } catch (e) {
        if (e.status === 404 || e.status === 403) return null
        throw e
      }
    })()

    const [branches, defaultBranch] = await Promise.all([
      branchesPromise,
      defaultPromise
    ])

    if (defaultBranch && branches.includes(defaultBranch)) {
      const idx = branches.indexOf(defaultBranch)
      branches.splice(idx, 1)
      branches.unshift(defaultBranch)
    }

    return { defaultBranch, branches }
  }

  async function getBuilds(slug, opts = {}) {
    if (!slug || typeof slug !== 'string') return []
    const pagelen = opts.pagelen ?? 20
    const branch = opts.branch || null
    const client = buildClient()
    const id = projectIdFor(client, slug)

    let url = `/projects/${id}/pipelines?per_page=${pagelen}`
    if (branch) url += `&ref=${encodeURIComponent(branch)}`

    let data
    try {
      data = await client.request(url)
    } catch (e) {
      if (e.status === 404 || e.status === 403) return []
      throw e
    }

    return (Array.isArray(data) ? data : []).map((p) => ({
      uuid: String(p.id),
      buildNumber: p.iid ?? p.id ?? 0,
      state: normalizePipelineStatus(p.status),
      createdOn: p.created_at || '',
      completedOn: p.updated_at && isCompleted(p.status) ? p.updated_at : null,
      durationSeconds:
        typeof p.duration === 'number'
          ? p.duration
          : p.created_at && p.updated_at && isCompleted(p.status)
          ? Math.max(
              0,
              Math.round(
                (new Date(p.updated_at).getTime() -
                  new Date(p.created_at).getTime()) /
                  1000
              )
            )
          : null,
      branch: p.ref || null,
      commitHash: p.sha || null,
      author: p.user?.username || p.user?.name || 'unknown',
      url:
        p.web_url ||
        `${client.baseUrl}/${client.workspace}/${slug}/-/pipelines/${p.id}`
    }))
  }

  async function getBuildSteps(slug, pipelineId) {
    if (!slug || !pipelineId) return []
    const client = buildClient()
    const id = projectIdFor(client, slug)
    const pid = encodeURIComponent(pipelineId)

    let data
    try {
      data = await client.request(
        `/projects/${id}/pipelines/${pid}/jobs?per_page=100`
      )
    } catch (e) {
      if (e.status === 404 || e.status === 403) return []
      throw e
    }

    return (Array.isArray(data) ? data : []).map((j) => ({
      uuid: String(j.id),
      name: j.name || '(unnamed job)',
      state: normalizePipelineStatus(j.status),
      durationSeconds:
        typeof j.duration === 'number'
          ? j.duration
          : j.started_at && j.finished_at
          ? Math.max(
              0,
              Math.round(
                (new Date(j.finished_at).getTime() -
                  new Date(j.started_at).getTime()) /
                  1000
              )
            )
          : null
    }))
  }

  async function getBuildStepLog(slug, _pipelineId, jobId) {
    // GitLab отдаёт лог per-job через /jobs/{id}/trace plain text'ом.
    // pipeline_id для лога не нужен — job-id сам уникален в проекте.
    if (!slug || !jobId) return ''
    const client = buildClient()
    const id = projectIdFor(client, slug)
    const jid = encodeURIComponent(jobId)
    try {
      return await client.request(`/projects/${id}/jobs/${jid}/trace`, {
        asText: true
      })
    } catch (e) {
      if (e.status === 404 || e.status === 403) return ''
      throw e
    }
  }

  async function getLastCommit(slug) {
    if (!slug || typeof slug !== 'string') return null
    const client = buildClient()
    const id = projectIdFor(client, slug)

    let data
    try {
      data = await client.request(
        `/projects/${id}/repository/commits?per_page=1`
      )
    } catch (e) {
      if (e.status === 404 || e.status === 403) return null
      throw e
    }
    const c = Array.isArray(data) ? data[0] : null
    if (!c) return null
    return {
      message: typeof c.message === 'string' ? c.message : '',
      author: c.author_name || c.committer_name || 'unknown',
      date: c.committed_date || c.authored_date || '',
      hash: c.id || ''
    }
  }

  function getCloneUrl(slug, gitUsername) {
    const baseUrl = resolveBaseUrl()
    const host = new URL(baseUrl).host
    const ws = getWorkspace()
    // Префикс username@ — подсказка для Git Credential Manager'а.
    // Если поле gitUsername пусто, fallback на текущий username (login).
    const userPrefix = gitUsername
      ? `${gitUsername}@`
      : getUsername()
      ? `${getUsername()}@`
      : ''
    return `https://${userPrefix}${host}/${ws}/${slug}.git`
  }

  function toProviderRepo(repo) {
    return {
      slug: repo.path || repo.name,
      name: repo.name || repo.path,
      description: repo.description || '',
      // GitLab не имеет прямого аналога is_template в публичном API.
      // Все repos считаются 'project'.
      kind: 'project',
      url: repo.web_url || '',
      cloneUrl: repo.http_url_to_repo || '',
      updatedOn: repo.last_activity_at || repo.updated_at || null,
      projectKey: ''
    }
  }

  /**
   * Корневой listing по default-branch через
   * /repository/tree?recursive=false. Возвращает только имена.
   */
  async function listRootFiles(slug) {
    if (!slug || typeof slug !== 'string') return []
    const client = buildClient()
    const id = projectIdFor(client, slug)
    try {
      const data = await client.request(
        `/projects/${id}/repository/tree?per_page=100&recursive=false`
      )
      if (!Array.isArray(data)) return []
      return data
        .map((entry) => entry?.name)
        .filter((n) => typeof n === 'string')
    } catch (e) {
      if (e.status === 404 || e.status === 403) return []
      throw e
    }
  }

  /**
   * Raw-текст файла на default-ветке: /repository/files/{path}/raw.
   * Path-сегменты должны быть URL-encoded целиком (включая `/`),
   * GitLab API принимает encoded path.
   */
  async function getFileText(slug, filePath) {
    if (!slug || !filePath) return null
    const client = buildClient()
    const id = projectIdFor(client, slug)
    const cleanPath = filePath.replace(/^\/+/, '')
    const encoded = encodeURIComponent(cleanPath)
    try {
      return await client.request(
        `/projects/${id}/repository/files/${encoded}/raw?ref=HEAD`,
        { asText: true }
      )
    } catch (e) {
      if (e.status === 404 || e.status === 403) return null
      throw e
    }
  }

  return {
    type: 'gitlab',
    capabilities: {
      builds: true,
      branches: true,
      commits: true,
      commitDiff: true
    },
    testConnection,
    listRepos,
    getRepo,
    getCommits,
    getCommitDetail,
    getCommitFileDiff,
    getBranches,
    getBuilds,
    getBuildSteps,
    getBuildStepLog,
    getLastCommit,
    getCloneUrl,
    listRootFiles,
    getFileText
  }
}

/**
 * GitLab pipeline / job статусы → наша унифицированная семантика.
 *   created/pending/preparing/waiting_for_resource/scheduled → PENDING
 *   running                                                  → IN_PROGRESS
 *   manual                                                   → PAUSED
 *   success                                                  → SUCCESSFUL
 *   failed                                                   → FAILED
 *   canceled / skipped                                       → STOPPED
 *   anything else                                            → PENDING
 */
function normalizePipelineStatus(status) {
  switch (status) {
    case 'created':
    case 'pending':
    case 'preparing':
    case 'waiting_for_resource':
    case 'scheduled':
      return 'PENDING'
    case 'running':
      return 'IN_PROGRESS'
    case 'manual':
      return 'PAUSED'
    case 'success':
      return 'SUCCESSFUL'
    case 'failed':
      return 'FAILED'
    case 'canceled':
    case 'cancelled':
    case 'skipped':
      return 'STOPPED'
    default:
      return 'PENDING'
  }
}

function isCompleted(status) {
  return ['success', 'failed', 'canceled', 'cancelled', 'skipped'].includes(
    status
  )
}

function mapFileStatus(diffEntry) {
  if (diffEntry.new_file) return 'added'
  if (diffEntry.deleted_file) return 'removed'
  if (diffEntry.renamed_file) return 'renamed'
  return 'modified'
}

function countDiffLines(diff, prefix) {
  if (typeof diff !== 'string' || !diff) return 0
  let count = 0
  // Считаем только реальные diff-строки (одиночный + или -),
  // skip'аем `+++` / `---` заголовки. Простая эвристика без полного
  // unified-diff parser'а.
  for (const line of diff.split('\n')) {
    if (line.startsWith(prefix) && !line.startsWith(prefix + prefix)) {
      count += 1
    }
  }
  return count
}

function toCommitShape(c) {
  return {
    hash: c.id || '',
    message: typeof c.message === 'string' ? c.message : '',
    date: c.committed_date || c.authored_date || '',
    author: c.author_name || c.committer_name || 'unknown',
    authorAccountId: null,
    parents: Array.isArray(c.parent_ids) ? c.parent_ids : []
  }
}
