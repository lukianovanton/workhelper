/**
 * Реализация VcsProvider для GitHub (REST API v3 + Actions).
 *
 * Auth: Personal Access Token (classic или fine-grained, scope `repo`
 * для приватных репо + `actions:read` если хочется видеть workflows).
 * Шлём как `Authorization: Bearer <token>` — работает для обоих
 * форматов токенов.
 *
 * `workspace` в нашей VcsSourceConfig для GitHub содержит owner —
 * либо username юзера, либо slug организации. Listing пробует
 * /orgs/{owner}/repos, затем /users/{owner}/repos — определяет тип
 * автоматически.
 *
 * Pipelines у GitHub нет — есть Actions workflow runs. Маппим:
 *   builds      ↔ workflow runs (/actions/runs)
 *   buildSteps  ↔ jobs of one run (/actions/runs/{id}/jobs)
 *   stepLog     ↔ job log (/actions/jobs/{id}/logs) — у GitHub лог
 *                  выдаётся per-job целиком; per-step deep-link в UI
 *                  есть только в браузере. Возвращаем job-лог.
 *
 * @typedef {import('./types.js').VcsProvider} VcsProvider
 * @typedef {import('./types.js').ProviderRepo} ProviderRepo
 */

import Store from 'electron-store'

const API_BASE = 'https://api.github.com'
const TTL_MS = 10 * 60 * 1000
const COMMIT_DETAIL_TTL_MS = 5 * 60 * 1000

class GitHubError extends Error {
  constructor(message, status, stage) {
    super(message)
    this.name = 'GitHubError'
    this.status = status
    this.stage = stage
  }
}

/**
 * @param {Object} opts
 * @param {() => string} opts.getOwner          owner (org или user)
 * @param {() => string} opts.getUsername       GitHub login (для verbose
 *                                                ошибок и testConnection
 *                                                fallback'а)
 * @param {() => string|null} opts.getToken
 * @param {string} opts.cacheKey                имя electron-store файла
 * @returns {VcsProvider}
 */
export function createGitHubProvider({
  getOwner,
  getUsername,
  getToken,
  cacheKey
}) {
  const cacheStore = new Store({
    name: cacheKey,
    clearInvalidConfig: true
  })

  /** @type {Map<string, {detail: any, ts: number}>} */
  const commitDetailMemo = new Map()

  function buildClient() {
    const token = getToken()
    const owner = getOwner()
    if (!token) {
      throw new GitHubError(
        'GitHub token not configured. Open Settings to add a Personal Access Token.',
        0,
        'config'
      )
    }
    if (!owner) {
      throw new GitHubError(
        'GitHub owner (user or organization) not set. Open Settings.',
        0,
        'config'
      )
    }

    async function request(pathOrUrl, opts = {}) {
      const url = pathOrUrl.startsWith('http')
        ? pathOrUrl
        : `${API_BASE}${pathOrUrl}`

      // Special accept-headers per call:
      //   asText   → text/plain (raw diff / log)
      //   asDiff   → application/vnd.github.diff (unified diff)
      // По умолчанию JSON.
      const accept = opts.asDiff
        ? 'application/vnd.github.diff'
        : opts.asText
        ? 'text/plain, */*'
        : 'application/vnd.github+json'

      const res = await fetch(url, {
        headers: {
          Accept: accept,
          'X-GitHub-Api-Version': '2022-11-28',
          Authorization: `Bearer ${token}`,
          'User-Agent': 'WorkHelper'
        }
      })

      if (res.status === 401) {
        throw new GitHubError(
          'Authentication failed (401). Check that the GitHub token is valid and not revoked.',
          401,
          'auth'
        )
      }
      if (res.status === 403) {
        // GitHub также возвращает 403 при rate-limit'е; смотрим заголовок.
        const remaining = res.headers.get('x-ratelimit-remaining')
        if (remaining === '0') {
          throw new GitHubError(
            'GitHub rate limit exceeded. Wait until the limit resets and retry.',
            403,
            'rate-limit'
          )
        }
        throw new GitHubError(
          'Forbidden (403). Token is valid but lacks permissions for this resource.',
          403,
          'auth'
        )
      }
      if (res.status === 404) {
        throw new GitHubError(
          'Not found (404). Owner or repository does not exist, or you do not have access.',
          404,
          'not-found'
        )
      }
      if (res.status === 429) {
        throw new GitHubError(
          'GitHub rate limit (secondary) exceeded. Slow down and retry in a minute.',
          429,
          'rate-limit'
        )
      }
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        throw new GitHubError(
          `GitHub API ${res.status}: ${body.slice(0, 200) || res.statusText}`,
          res.status,
          'http'
        )
      }
      if (opts.asText || opts.asDiff) return res.text()
      return res.json()
    }

    return { request, owner }
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
          message:
            'Authentication failed (401). PAT is invalid or revoked.'
        }
      }
      return { ok: false, stage: e.stage || 'http', message: e.message }
    }

    // Проверка доступа к owner: пробуем /users/{owner} — публичный
    // эндпоинт, не упадёт даже если owner это org (вернёт user-like
    // объект). Для определения org vs user — другой запрос, но нам
    // достаточно того, что owner отдалось.
    let workspace = { slug: client.owner, name: client.owner }
    try {
      const ownerInfo = await client.request(
        `/users/${encodeURIComponent(client.owner)}`
      )
      workspace = {
        slug: ownerInfo.login || client.owner,
        name: ownerInfo.name || ownerInfo.login || client.owner,
        type: ownerInfo.type // 'User' | 'Organization'
      }
    } catch {
      // ignore — owner может быть org с приватным профилем
    }

    return {
      ok: true,
      user: {
        accountId: String(user.id),
        displayName: user.name || user.login,
        username: user.login
      },
      workspace
    }
  }

  async function listAllRepos() {
    const client = buildClient()
    const owner = encodeURIComponent(client.owner)

    // Owner может быть org или user. Пробуем org-эндпоинт; на 404
    // фолбэчимся на user-эндпоинт. Не используем /user/repos
    // (личные + collaborations + orgs), чтобы owner-фильтр был чёткий.
    /** @type {any[]} */
    const all = []
    let url = `/orgs/${owner}/repos?per_page=100&type=all&sort=updated`
    let isOrgEndpoint = true
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
            url = isOrgEndpoint
              ? `/orgs/${owner}/repos?per_page=100&type=all&sort=updated&page=${page}`
              : `/users/${owner}/repos?per_page=100&type=owner&sort=updated&page=${page}`
          }
        } else {
          url = null
        }
      } catch (e) {
        if (e.status === 404 && isOrgEndpoint) {
          // Это user, не org. Перезапускаем с user-эндпоинта.
          all.length = 0
          isOrgEndpoint = false
          page = 1
          url = `/users/${owner}/repos?per_page=100&type=owner&sort=updated`
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
    const owner = encodeURIComponent(client.owner)
    const s = encodeURIComponent(slug)
    try {
      const repo = await client.request(`/repos/${owner}/${s}`)
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
    const owner = encodeURIComponent(client.owner)
    const s = encodeURIComponent(slug)

    let url = `/repos/${owner}/${s}/commits?per_page=${pagelen}`
    if (branch) url += `&sha=${encodeURIComponent(branch)}`

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
    const owner = encodeURIComponent(client.owner)
    const s = encodeURIComponent(slug)
    const h = encodeURIComponent(hash)
    let detail
    try {
      detail = await client.request(`/repos/${owner}/${s}/commits/${h}`)
    } catch (e) {
      if (e.status === 404 || e.status === 403) return null
      throw e
    }
    commitDetailMemo.set(cacheKey, { detail, ts: Date.now() })
    return detail
  }

  async function getCommitDetail(slug, hash) {
    if (!slug || !hash) return null
    const detail = await getCommitDetailRaw(slug, hash)
    if (!detail) return null
    const client = buildClient()

    const files = (detail.files || []).map((f) => ({
      status: mapFileStatus(f.status),
      linesAdded: f.additions || 0,
      linesRemoved: f.deletions || 0,
      path: f.filename || f.previous_filename || '(unknown)'
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

    const commit = detail.commit || {}
    return {
      hash: detail.sha || hash,
      message: typeof commit.message === 'string' ? commit.message : '',
      date: commit.author?.date || commit.committer?.date || '',
      author:
        detail.author?.login ||
        commit.author?.name ||
        'unknown',
      authorAccountId: detail.author?.id ? String(detail.author.id) : null,
      parents: Array.isArray(detail.parents)
        ? detail.parents.map((p) => p?.sha).filter(Boolean)
        : [],
      diffstat,
      url: `https://github.com/${client.owner}/${slug}/commit/${detail.sha || hash}`
    }
  }

  async function getCommitFileDiff(slug, hash, path) {
    if (!slug || !hash || !path) return ''
    const detail = await getCommitDetailRaw(slug, hash)
    if (!detail) return ''
    const file = (detail.files || []).find(
      (f) => f.filename === path || f.previous_filename === path
    )
    return file?.patch || ''
  }

  async function getBranches(slug) {
    if (!slug || typeof slug !== 'string') {
      return { defaultBranch: null, branches: [] }
    }
    const client = buildClient()
    const owner = encodeURIComponent(client.owner)
    const s = encodeURIComponent(slug)

    const branchesPromise = (async () => {
      /** @type {string[]} */
      const out = []
      let page = 1
      while (true) {
        let data
        try {
          data = await client.request(
            `/repos/${owner}/${s}/branches?per_page=100&page=${page}`
          )
        } catch (e) {
          if (e.status === 404 || e.status === 403) break
          throw e
        }
        if (!Array.isArray(data) || data.length === 0) break
        for (const b of data) {
          if (b?.name) out.push(b.name)
        }
        if (data.length < 100) break
        page += 1
      }
      return out
    })()

    const defaultPromise = (async () => {
      try {
        const repo = await client.request(`/repos/${owner}/${s}`)
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
    const owner = encodeURIComponent(client.owner)
    const s = encodeURIComponent(slug)

    let url = `/repos/${owner}/${s}/actions/runs?per_page=${pagelen}`
    if (branch) url += `&branch=${encodeURIComponent(branch)}`

    let data
    try {
      data = await client.request(url)
    } catch (e) {
      if (e.status === 404 || e.status === 403) return []
      throw e
    }

    const runs = data?.workflow_runs || []
    return runs.map((r) => ({
      uuid: String(r.id),
      buildNumber: r.run_number ?? 0,
      state: normalizeWorkflowState(r),
      createdOn: r.created_at || '',
      completedOn: r.updated_at && r.status === 'completed' ? r.updated_at : null,
      durationSeconds:
        r.created_at && r.updated_at && r.status === 'completed'
          ? Math.max(
              0,
              Math.round(
                (new Date(r.updated_at).getTime() -
                  new Date(r.created_at).getTime()) /
                  1000
              )
            )
          : null,
      branch: r.head_branch || null,
      commitHash: r.head_sha || null,
      author: r.actor?.login || r.triggering_actor?.login || 'unknown',
      url: r.html_url || `https://github.com/${client.owner}/${slug}/actions/runs/${r.id}`
    }))
  }

  async function getBuildSteps(slug, runId) {
    if (!slug || !runId) return []
    const client = buildClient()
    const owner = encodeURIComponent(client.owner)
    const s = encodeURIComponent(slug)
    const id = encodeURIComponent(runId)

    let data
    try {
      data = await client.request(
        `/repos/${owner}/${s}/actions/runs/${id}/jobs?per_page=100`
      )
    } catch (e) {
      if (e.status === 404 || e.status === 403) return []
      throw e
    }

    const jobs = data?.jobs || []
    return jobs.map((j) => ({
      uuid: String(j.id),
      name: j.name || '(unnamed job)',
      state: normalizeWorkflowState(j),
      durationSeconds:
        j.started_at && j.completed_at
          ? Math.max(
              0,
              Math.round(
                (new Date(j.completed_at).getTime() -
                  new Date(j.started_at).getTime()) /
                  1000
              )
            )
          : null
    }))
  }

  async function getBuildStepLog(slug, _runId, jobId) {
    // GitHub отдаёт лог per-job, не per-step. step_uuid в нашей модели
    // = job.id у GitHub, поэтому stepUuid и есть jobId.
    if (!slug || !jobId) return ''
    const client = buildClient()
    const owner = encodeURIComponent(client.owner)
    const s = encodeURIComponent(slug)
    const id = encodeURIComponent(jobId)
    try {
      // /jobs/{id}/logs возвращает 302 на signed S3 URL; fetch
      // следует за редиректами автоматически. Контент — text/plain.
      return await client.request(
        `/repos/${owner}/${s}/actions/jobs/${id}/logs`,
        { asText: true }
      )
    } catch (e) {
      if (e.status === 404 || e.status === 403) return ''
      // 410 Gone — лог истёк (GitHub чистит >90 дней). Не ошибка.
      if (e.status === 410) return ''
      throw e
    }
  }

  async function getLastCommit(slug) {
    if (!slug || typeof slug !== 'string') return null
    const client = buildClient()
    const owner = encodeURIComponent(client.owner)
    const s = encodeURIComponent(slug)

    let data
    try {
      data = await client.request(
        `/repos/${owner}/${s}/commits?per_page=1`
      )
    } catch (e) {
      if (e.status === 404 || e.status === 403) return null
      throw e
    }

    const c = Array.isArray(data) ? data[0] : null
    if (!c) return null
    const commit = c.commit || {}
    return {
      message: typeof commit.message === 'string' ? commit.message : '',
      author:
        c.author?.login ||
        commit.author?.name ||
        'unknown',
      date: commit.author?.date || commit.committer?.date || '',
      hash: c.sha || ''
    }
  }

  function getCloneUrl(slug, gitUsername) {
    const owner = getOwner()
    // Для git Credential Manager'а полезно подставить username — это
    // подсказка, под какой identity открывать токен. Если поле пусто,
    // используем owner (часто совпадает с самим юзером).
    const userPrefix = gitUsername
      ? `${gitUsername}@`
      : getUsername()
      ? `${getUsername()}@`
      : ''
    return `https://${userPrefix}github.com/${owner}/${slug}.git`
  }

  function toProviderRepo(repo) {
    return {
      slug: repo.name,
      name: repo.name,
      description: repo.description || '',
      kind: repo.is_template ? 'template' : 'project',
      url: repo.html_url || `https://github.com/${repo.full_name}`,
      cloneUrl: repo.clone_url || '',
      updatedOn: repo.updated_at || repo.pushed_at || null,
      // GitHub-specific: project.key у BB используется для тултипа kind;
      // у GH аналога нет, кладём пусто.
      projectKey: ''
    }
  }

  /**
   * Корневой listing на default-ветке (GitHub `/contents/` по
   * умолчанию — на default branch). Возвращает только имена файлов и
   * директорий, без рекурсии.
   */
  async function listRootFiles(slug) {
    if (!slug || typeof slug !== 'string') return []
    const client = buildClient()
    const owner = encodeURIComponent(client.owner)
    const s = encodeURIComponent(slug)
    try {
      const data = await client.request(`/repos/${owner}/${s}/contents/`)
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
   * Raw-текст файла на default-ветке через
   * `Accept: application/vnd.github.raw`. Лимит у GH ~1MB на raw —
   * больших файлов мы и так не запрашиваем (manifests).
   */
  async function getFileText(slug, filePath) {
    if (!slug || !filePath) return null
    const client = buildClient()
    const owner = encodeURIComponent(client.owner)
    const s = encodeURIComponent(slug)
    // path-сегменты в /contents/ должны быть URL-encoded по сегментам.
    const cleanPath = filePath
      .replace(/^\/+/, '')
      .split('/')
      .map((seg) => encodeURIComponent(seg))
      .join('/')
    try {
      // Используем asText + Accept: application/vnd.github.raw — делает
      // request().
      // request() уже подставляет Accept: github.diff под opts.asDiff;
      // raw-формат GitHub'а покрываем asText (default Accept fallback).
      // На стороне fetch это сработает потому что api.github.com
      // отдаёт raw для /contents/{path} с Accept: */* … но безопаснее
      // явно указать raw через extra headers — у нас такого хука нет.
      // Решение: использовать опцию asText (text/plain), GitHub при
      // этом отдаёт JSON-обёртку. Декодируем её вручную ниже.
      // Чтобы избежать парсинга base64 — добавим asDiff-trick? Нет,
      // он шлёт другой Accept. Простейший путь: обычный JSON-ответ
      // и base64-decode content.
      const data = await client.request(`/repos/${owner}/${s}/contents/${cleanPath}`)
      if (data?.encoding === 'base64' && typeof data.content === 'string') {
        return Buffer.from(data.content, 'base64').toString('utf8')
      }
      return null
    } catch (e) {
      if (e.status === 404 || e.status === 403) return null
      throw e
    }
  }

  return {
    type: 'github',
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
 * GitHub Actions run / job → нормализованный state приложения.
 *   queued      → PENDING
 *   in_progress → IN_PROGRESS
 *   completed   → SUCCESSFUL / FAILED / STOPPED / ERROR / PAUSED по conclusion
 */
function normalizeWorkflowState(runOrJob) {
  if (!runOrJob) return 'PENDING'
  const status = runOrJob.status
  const conclusion = runOrJob.conclusion
  if (status === 'queued' || status === 'pending' || status === 'waiting') {
    return 'PENDING'
  }
  if (status === 'in_progress') return 'IN_PROGRESS'
  if (status === 'completed') {
    switch (conclusion) {
      case 'success':
        return 'SUCCESSFUL'
      case 'failure':
        return 'FAILED'
      case 'timed_out':
        return 'ERROR'
      case 'cancelled':
        return 'STOPPED'
      case 'skipped':
        return 'STOPPED'
      case 'neutral':
        return 'SUCCESSFUL'
      case 'action_required':
        return 'PAUSED'
      default:
        return 'PENDING'
    }
  }
  return 'PENDING'
}

function mapFileStatus(s) {
  switch (s) {
    case 'added':
      return 'added'
    case 'removed':
      return 'removed'
    case 'modified':
      return 'modified'
    case 'renamed':
      return 'renamed'
    case 'copied':
      return 'modified'
    default:
      return 'modified'
  }
}

function toCommitShape(c) {
  const commit = c.commit || {}
  return {
    hash: c.sha || '',
    message: typeof commit.message === 'string' ? commit.message : '',
    date: commit.author?.date || commit.committer?.date || '',
    author:
      c.author?.login ||
      commit.author?.name ||
      'unknown',
    authorAccountId: c.author?.id ? String(c.author.id) : null,
    parents: Array.isArray(c.parents)
      ? c.parents.map((p) => p?.sha).filter(Boolean)
      : []
  }
}
