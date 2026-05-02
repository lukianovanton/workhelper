/**
 * Реализация VcsProvider для Bitbucket Cloud (Basic Auth: email + API
 * token, нативный fetch).
 *
 * Phase A.4a: фабрика теперь принимает явные `{ workspace, username,
 * getToken, cacheKey }` — это позволяет создавать несколько инстансов
 * провайдера для разных source'ов (Phase A.4b даст пользователю это
 * через Settings UI). Cache list-репо теперь per-source: каждый
 * инстанс держит свой electron-store по `cacheKey`.
 *
 * @typedef {import('./types.js').VcsProvider} VcsProvider
 * @typedef {import('./types.js').ProviderRepo} ProviderRepo
 */

import Store from 'electron-store'

const API_BASE = 'https://api.bitbucket.org/2.0'
const TTL_MS = 10 * 60 * 1000
const LIST_FIELDS =
  'values.slug,values.name,values.description,values.links.clone,values.project.key,values.updated_on,next'

class BitbucketError extends Error {
  constructor(message, status, stage) {
    super(message)
    this.name = 'BitbucketError'
    this.status = status
    this.stage = stage
  }
}

/**
 * @param {Object} opts
 * @param {() => string} opts.getWorkspace      lazy getter — позволяет UI
 *                                                менять workspace без
 *                                                пересоздания инстанса
 * @param {() => string} opts.getUsername       lazy getter
 * @param {() => string|null} opts.getToken     lazy getter секрета
 * @param {string} opts.cacheKey                имя electron-store файла для
 *                                                listRepos cache
 *                                                (один файл на source)
 * @returns {VcsProvider}
 */
export function createBitbucketProvider({
  getWorkspace,
  getUsername,
  getToken,
  cacheKey
}) {
  const cacheStore = new Store({
    name: cacheKey,
    clearInvalidConfig: true
  })

  function buildClient() {
    const token = getToken()
    const username = getUsername()
    const workspace = getWorkspace()

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

    async function request(pathOrUrl, opts = {}) {
      const url = pathOrUrl.startsWith('http')
        ? pathOrUrl
        : `${API_BASE}${pathOrUrl}`

      const res = await fetch(url, {
        headers: {
          Accept: opts.asText ? 'text/plain, */*' : 'application/json',
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
      return opts.asText ? res.text() : res.json()
    }

    return { request, workspace, username }
  }

  async function testConnection() {
    let client
    try {
      client = buildClient()
    } catch (e) {
      return { ok: false, stage: e.stage || 'config', message: e.message }
    }

    try {
      await client.request(
        `/repositories/${encodeURIComponent(client.workspace)}?pagelen=1&fields=values.slug,next`
      )
    } catch (e) {
      if (e.status === 401) {
        return {
          ok: false,
          stage: 'auth',
          message:
            'Authentication failed (401). API token is invalid, revoked, or the email does not match the account.'
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

  async function listAllRepos() {
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

    return all.map((repo) => toProviderRepo(repo, client.workspace))
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
    const ws = encodeURIComponent(client.workspace)
    const s = encodeURIComponent(slug)
    try {
      const repo = await client.request(
        `/repositories/${ws}/${s}?fields=${encodeURIComponent(
          'slug,name,description,links.clone,project.key,updated_on'
        )}`
      )
      return toProviderRepo(repo, client.workspace)
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
    const fields = encodeURIComponent(
      'values.hash,values.message,values.date,values.author.user.display_name,values.author.user.account_id,values.author.raw,values.parents.hash'
    )
    const ws = encodeURIComponent(client.workspace)
    const s = encodeURIComponent(slug)
    const path = branch
      ? `/repositories/${ws}/${s}/commits/${encodeURIComponent(
          branch
        )}?pagelen=${pagelen}&fields=${fields}`
      : `/repositories/${ws}/${s}/commits?pagelen=${pagelen}&fields=${fields}`

    let data
    try {
      data = await client.request(path)
    } catch (e) {
      if (e.status === 404 || e.status === 403) return []
      throw e
    }

    return (data.values || []).map(toCommitShape)
  }

  async function getCommitDetail(slug, hash) {
    if (!slug || !hash) return null
    const client = buildClient()
    const ws = encodeURIComponent(client.workspace)
    const s = encodeURIComponent(slug)
    const h = encodeURIComponent(hash)

    const commitFields = encodeURIComponent(
      'hash,message,date,author.user.display_name,author.user.account_id,author.raw,parents.hash'
    )

    let commit
    try {
      commit = await client.request(
        `/repositories/${ws}/${s}/commit/${h}?fields=${commitFields}`
      )
    } catch (e) {
      if (e.status === 404 || e.status === 403) return null
      throw e
    }

    let diffstat = null
    try {
      const ds = await client.request(
        `/repositories/${ws}/${s}/diffstat/${h}?pagelen=100&fields=values.status,values.lines_added,values.lines_removed,values.old.path,values.new.path,next`
      )
      const files = (ds.values || []).map((f) => ({
        status: f.status || 'modified',
        linesAdded: f.lines_added || 0,
        linesRemoved: f.lines_removed || 0,
        path: f.new?.path || f.old?.path || '(unknown)'
      }))
      diffstat = {
        filesChanged: files.length,
        linesAdded: files.reduce((sum, f) => sum + f.linesAdded, 0),
        linesRemoved: files.reduce((sum, f) => sum + f.linesRemoved, 0),
        files,
        truncated: !!ds.next
      }
    } catch {
      // ignore
    }

    return {
      ...toCommitShape(commit),
      diffstat,
      url: `https://bitbucket.org/${client.workspace}/${slug}/commits/${commit.hash || hash}`
    }
  }

  async function getCommitFileDiff(slug, hash, path) {
    if (!slug || !hash || !path) return ''
    const client = buildClient()
    const ws = encodeURIComponent(client.workspace)
    const s = encodeURIComponent(slug)
    const h = encodeURIComponent(hash)
    const p = encodeURIComponent(path)
    try {
      return await client.request(
        `/repositories/${ws}/${s}/diff/${h}?path=${p}`,
        { asText: true }
      )
    } catch (e) {
      if (e.status === 404 || e.status === 403) return ''
      throw e
    }
  }

  async function getBranches(slug) {
    if (!slug || typeof slug !== 'string') {
      return { defaultBranch: null, branches: [] }
    }
    const client = buildClient()
    const ws = encodeURIComponent(client.workspace)
    const s = encodeURIComponent(slug)

    const branchesPromise = (async () => {
      /** @type {string[]} */
      const out = []
      let url =
        `/repositories/${ws}/${s}/refs/branches?pagelen=100&sort=name&fields=values.name,next`
      while (url) {
        let data
        try {
          data = await client.request(url)
        } catch (e) {
          if (e.status === 404 || e.status === 403) break
          throw e
        }
        for (const v of data.values || []) {
          if (v?.name) out.push(v.name)
        }
        url = data.next || null
      }
      return out
    })()

    const defaultPromise = (async () => {
      try {
        const data = await client.request(
          `/repositories/${ws}/${s}?fields=mainbranch.name`
        )
        return data?.mainbranch?.name || null
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
    const ws = encodeURIComponent(client.workspace)
    const s = encodeURIComponent(slug)
    const fields = encodeURIComponent(
      'values.uuid,values.build_number,values.state,values.created_on,values.completed_on,values.duration_in_seconds,values.target.ref_name,values.target.commit.hash,values.creator.display_name'
    )
    const branchQs = branch
      ? `&target.ref_name=${encodeURIComponent(branch)}`
      : ''
    const path = `/repositories/${ws}/${s}/pipelines/?pagelen=${pagelen}&sort=-created_on${branchQs}&fields=${fields}`

    let data
    try {
      data = await client.request(path)
    } catch (e) {
      if (e.status === 404 || e.status === 403) return []
      throw e
    }

    return (data.values || []).map((p) => ({
      uuid: p.uuid || '',
      buildNumber: p.build_number ?? 0,
      state: normalizePipelineState(p.state),
      createdOn: p.created_on || '',
      completedOn: p.completed_on || null,
      durationSeconds:
        typeof p.duration_in_seconds === 'number'
          ? p.duration_in_seconds
          : null,
      branch: p.target?.ref_name || null,
      commitHash: p.target?.commit?.hash || null,
      author: p.creator?.display_name || 'unknown',
      url: `https://bitbucket.org/${client.workspace}/${slug}/pipelines/results/${p.build_number}`
    }))
  }

  async function getBuildSteps(slug, pipelineUuid) {
    if (!slug || !pipelineUuid) return []
    const client = buildClient()
    const ws = encodeURIComponent(client.workspace)
    const s = encodeURIComponent(slug)
    const u = encodeURIComponent(pipelineUuid)
    const fields = encodeURIComponent(
      'values.uuid,values.name,values.state,values.duration_in_seconds'
    )

    let data
    try {
      data = await client.request(
        `/repositories/${ws}/${s}/pipelines/${u}/steps/?fields=${fields}`
      )
    } catch (e) {
      if (e.status === 404 || e.status === 403) return []
      throw e
    }

    return (data.values || []).map((step) => ({
      uuid: step.uuid || '',
      name: step.name || '(unnamed step)',
      state: normalizePipelineState(step.state),
      durationSeconds:
        typeof step.duration_in_seconds === 'number'
          ? step.duration_in_seconds
          : null
    }))
  }

  async function getBuildStepLog(slug, pipelineUuid, stepUuid) {
    if (!slug || !pipelineUuid || !stepUuid) return ''
    const client = buildClient()
    const ws = encodeURIComponent(client.workspace)
    const s = encodeURIComponent(slug)
    const u = encodeURIComponent(pipelineUuid)
    const su = encodeURIComponent(stepUuid)
    try {
      return await client.request(
        `/repositories/${ws}/${s}/pipelines/${u}/steps/${su}/log`,
        { asText: true }
      )
    } catch (e) {
      if (e.status === 404 || e.status === 403) return ''
      throw e
    }
  }

  async function getLastCommit(slug) {
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
      if (e.status === 404 || e.status === 403) return null
      throw e
    }

    const c = data.values?.[0]
    if (!c) return null

    const author =
      c.author?.user?.display_name || c.author?.raw || 'unknown'

    return {
      message: typeof c.message === 'string' ? c.message : '',
      author,
      date: c.date || '',
      hash: c.hash || ''
    }
  }

  function getCloneUrl(slug, gitUsername) {
    const workspace = getWorkspace()
    const userPrefix = gitUsername ? `${gitUsername}@` : ''
    return `https://${userPrefix}bitbucket.org/${workspace}/${slug.toLowerCase()}.git`
  }

  /**
   * BB src endpoint для default-ветки: вместо имени бранча допускается
   * `HEAD`, который сам резолвится. Возвращает {values:[{path,type}]}
   * — `path` это relative path, `type` ∈ {commit_directory, commit_file}.
   * Pagelen=100 для root'а с запасом.
   */
  async function listRootFiles(slug) {
    if (!slug || typeof slug !== 'string') return []
    const client = buildClient()
    const ws = encodeURIComponent(client.workspace)
    const s = encodeURIComponent(slug)
    try {
      const data = await client.request(
        `/repositories/${ws}/${s}/src/HEAD/?pagelen=100&fields=values.path,values.type,next`
      )
      return (data.values || [])
        .map((v) => {
          if (!v?.path) return null
          // path для root-листинга = "filename" или "subdir" — без слэшей.
          // На всякий случай отрезаем path-prefix если он там оказался.
          const idx = v.path.lastIndexOf('/')
          return idx >= 0 ? v.path.slice(idx + 1) : v.path
        })
        .filter(Boolean)
    } catch (e) {
      if (e.status === 404 || e.status === 403) return []
      throw e
    }
  }

  async function getFileText(slug, filePath) {
    if (!slug || !filePath) return null
    const client = buildClient()
    const ws = encodeURIComponent(client.workspace)
    const s = encodeURIComponent(slug)
    // BB ожидает path-сегменты как есть (без encodeURIComponent для /).
    const cleanPath = filePath.replace(/^\/+/, '')
    try {
      const text = await client.request(
        `/repositories/${ws}/${s}/src/HEAD/${cleanPath}`,
        { asText: true }
      )
      return typeof text === 'string' ? text : null
    } catch (e) {
      if (e.status === 404 || e.status === 403) return null
      throw e
    }
  }

  return {
    type: 'bitbucket',
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

function normalizePipelineState(state) {
  if (!state) return 'PENDING'
  if (state.name === 'COMPLETED' && state.result?.name) {
    return state.result.name
  }
  if (state.name === 'IN_PROGRESS' && state.stage?.name === 'PAUSED') {
    return 'PAUSED'
  }
  return state.name || 'PENDING'
}

function toCommitShape(c) {
  return {
    hash: c.hash || '',
    message: typeof c.message === 'string' ? c.message : '',
    date: c.date || '',
    author:
      c.author?.user?.display_name || c.author?.raw || 'unknown',
    authorAccountId: c.author?.user?.account_id || null,
    parents: Array.isArray(c.parents)
      ? c.parents.map((p) => p?.hash).filter(Boolean)
      : []
  }
}

function toProviderRepo(repo, workspace) {
  const cloneUrl =
    (repo.links?.clone || []).find((c) => c.name === 'https')?.href || ''
  const projectKey = repo.project?.key || ''

  return {
    slug: repo.slug,
    name: repo.name,
    description: repo.description || '',
    kind: projectKey.startsWith('TP') ? 'template' : 'project',
    url: `https://bitbucket.org/${workspace}/${repo.slug}`,
    cloneUrl,
    updatedOn: repo.updated_on || null,
    projectKey
  }
}
