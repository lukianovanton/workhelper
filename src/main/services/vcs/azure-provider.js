/**
 * Реализация VcsProvider для Azure DevOps (Cloud + Server).
 *
 * Auth: Personal Access Token. Передаётся как Basic-auth с пустым
 * username — стандартная конвенция Azure DevOps:
 *   Authorization: Basic base64(":" + PAT)
 *
 * Hierarchy у AzDO трёхуровневая: organization → project → repository.
 * Это сложнее GitHub/GitLab где flat namespace. Мы маппим:
 *   workspace = organization (один source = одна организация)
 *   slug      = repo.name (внутри организации почти всегда уникален;
 *                          collision'ы в registry разрулены first-wins)
 *
 * Поскольку API requires {project}/{repoId}-paths для большинства
 * запросов, а юзер видит только slug, провайдер ведёт in-memory map'у
 * `slugToRepo: Map<slug, {repoId, projectName, defaultBranch}>`,
 * заполняемую на listRepos. Per-slug методы lookup'ятся в этой map'е.
 * Если slug в неё не попал (cold cache + первое обращение к
 * неклонированному проекту) — ленивый refresh listRepos и retry.
 *
 * Pipelines маппятся через Build API (не Pipelines API — он более новый,
 * но менее удобен per-repo):
 *   builds      ↔ /build/builds?repositoryId=...
 *   buildSteps  ↔ /build/builds/{id}/timeline (filter type='Job')
 *   stepLog     ↔ /build/builds/{id}/logs/{logId}  (plain text)
 *
 * Self-hosted Azure DevOps Server: baseUrl из providerOptions.baseUrl.
 * Default 'https://dev.azure.com'. Старый формат '{org}.visualstudio.com'
 * работает через прежний URL (Microsoft до сих пор поддерживает).
 *
 * @typedef {import('./types.js').VcsProvider} VcsProvider
 * @typedef {import('./types.js').ProviderRepo} ProviderRepo
 */

import Store from 'electron-store'

const TTL_MS = 10 * 60 * 1000
const COMMIT_DETAIL_TTL_MS = 5 * 60 * 1000
const API_VERSION = '7.1'

class AzureError extends Error {
  constructor(message, status, stage) {
    super(message)
    this.name = 'AzureError'
    this.status = status
    this.stage = stage
  }
}

/**
 * @param {Object} opts
 * @param {() => string} opts.getWorkspace      lazy: AzDO organization
 * @param {() => string} opts.getUsername       lazy: login для clone-URL
 * @param {() => string|null} opts.getToken     lazy: PAT
 * @param {string} opts.cacheKey                имя electron-store файла
 * @param {() => string} [opts.getBaseUrl]      lazy: base URL.
 *                                                Default 'https://dev.azure.com'.
 * @returns {VcsProvider}
 */
export function createAzureDevOpsProvider({
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

  /** @type {Map<string, {repoId: string, projectName: string, defaultBranch: string|null}>} */
  const slugToRepo = new Map()

  /** @type {Map<string, {detail: any, ts: number}>} */
  const commitDetailMemo = new Map()

  function resolveBaseUrl() {
    const raw = (getBaseUrl && getBaseUrl()) || 'https://dev.azure.com'
    return raw.replace(/\/+$/, '')
  }

  function buildClient() {
    const token = getToken()
    const org = getWorkspace()
    const baseUrl = resolveBaseUrl()

    if (!token) {
      throw new AzureError(
        'Azure DevOps token not configured. Open Settings to add a Personal Access Token.',
        0,
        'config'
      )
    }
    if (!org) {
      throw new AzureError(
        'Azure DevOps organization not set. Open Settings.',
        0,
        'config'
      )
    }

    // PAT отдаётся через Basic auth с пустым username. Buffer/btoa в
    // main-процессе доступны (Node API), используем Buffer для ясности.
    const authValue = Buffer.from(`:${token}`).toString('base64')
    const orgUrl = `${baseUrl}/${encodeURIComponent(org)}`

    async function request(pathOrUrl, opts = {}) {
      const url = pathOrUrl.startsWith('http')
        ? pathOrUrl
        : `${orgUrl}${pathOrUrl}`
      // api-version обязателен почти везде. Если в path уже есть `?` —
      // дописываем `&api-version=`, иначе `?api-version=`.
      const finalUrl = url.includes('api-version=')
        ? url
        : url + (url.includes('?') ? '&' : '?') + `api-version=${API_VERSION}`

      const accept = opts.asText
        ? 'text/plain, */*'
        : 'application/json'

      const res = await fetch(finalUrl, {
        headers: {
          Accept: accept,
          Authorization: `Basic ${authValue}`,
          'User-Agent': 'WorkHelper'
        }
      })

      if (res.status === 401) {
        throw new AzureError(
          'Authentication failed (401). PAT is invalid, expired, or revoked.',
          401,
          'auth'
        )
      }
      if (res.status === 203) {
        // AzDO возвращает 203 Non-Authoritative когда авторизация
        // не прошла, но эндпоинт публичный — body это HTML логин-страницы.
        // Это значит токен невалидный для этой операции.
        throw new AzureError(
          'Authorization rejected (203). PAT lacks required scope or is invalid for this operation.',
          203,
          'auth'
        )
      }
      if (res.status === 403) {
        throw new AzureError(
          'Forbidden (403). Token is valid but lacks permissions or required scope (Code: Read / Build: Read).',
          403,
          'auth'
        )
      }
      if (res.status === 404) {
        throw new AzureError(
          'Not found (404). Organization, project, or repository does not exist, or you do not have access.',
          404,
          'not-found'
        )
      }
      if (res.status === 429) {
        throw new AzureError(
          'Azure DevOps rate limit exceeded. Slow down and retry in a minute.',
          429,
          'rate-limit'
        )
      }
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        throw new AzureError(
          `Azure DevOps API ${res.status}: ${body.slice(0, 200) || res.statusText}`,
          res.status,
          'http'
        )
      }
      if (opts.asText) return res.text()
      return res.json()
    }

    return { request, org, baseUrl, orgUrl }
  }

  /**
   * Резолвит { repoId, projectName } для slug'а через cached map.
   * Если slug не в map — refresh списка и повтор. Если и после
   * refresh'а нет — null.
   */
  async function resolveRepoMeta(slug) {
    if (slugToRepo.has(slug)) return slugToRepo.get(slug)
    // Cold path: перезагрузим список (невелика стоимость, делается раз
    // при первом обращении к неcached slug'у).
    await listRepos(true)
    return slugToRepo.get(slug) || null
  }

  function shortRef(refName) {
    // refs/heads/main → main
    if (typeof refName !== 'string') return null
    return refName.replace(/^refs\/heads\//, '')
  }

  async function testConnection() {
    let client
    try {
      client = buildClient()
    } catch (e) {
      return { ok: false, stage: e.stage || 'config', message: e.message }
    }

    // /_apis/projects?api-version=7.1 — список проектов в org. Заодно
    // даёт user-info в response headers (X-VSS-UserData) который не
    // парсится через нашу request функцию. Делаем отдельный
    // /_apis/connectiondata для identity (lightweight, без права).
    let identity = { displayName: getUsername() || client.org }
    try {
      const data = await client.request('/_apis/ConnectionData')
      const u = data.authenticatedUser
      if (u) {
        identity = {
          accountId: u.id ? String(u.id) : null,
          displayName: u.providerDisplayName || u.customDisplayName || identity.displayName,
          username: u.subjectDescriptor || u.providerDisplayName || identity.displayName
        }
      }
    } catch (e) {
      if (e.status === 401 || e.status === 203) {
        return {
          ok: false,
          stage: 'auth',
          message: 'Authentication failed. PAT is invalid or revoked.'
        }
      }
      // Не-fatal — пробуем дальше.
    }

    let workspace = { slug: client.org, name: client.org }
    try {
      const projects = await client.request(
        '/_apis/projects?$top=1'
      )
      // Сам факт того что projects-эндпоинт ответил говорит о том, что
      // PAT работает с org. Имя org мы и так знаем, лишний lookup не
      // делаем — у Azure нет публичного `/orgs/{org}` эндпоинта без
      // ConnectionData.
      workspace = {
        slug: client.org,
        name: client.org,
        type: 'Organization',
        projectCount: projects?.count ?? null
      }
    } catch (e) {
      return {
        ok: false,
        stage: 'workspace',
        message: `Could not access organization "${client.org}": ${e.message}`
      }
    }

    return {
      ok: true,
      user: identity,
      workspace
    }
  }

  async function listAllRepos() {
    const client = buildClient()
    // Org-wide список репо: один запрос, без пагинации (Azure не
    // лимитирует /_apis/git/repositories для разумного числа репо).
    const data = await client.request('/_apis/git/repositories')
    const repos = Array.isArray(data?.value) ? data.value : []

    // Re-build slug→repo-meta map'у с нуля, чтобы stale-записи
    // (удалённые репо) не висели после refresh.
    slugToRepo.clear()
    for (const r of repos) {
      const slug = r.name
      const repoId = r.id
      const projectName = r.project?.name || ''
      if (!slug || !repoId || !projectName) continue
      slugToRepo.set(slug, {
        repoId,
        projectName,
        defaultBranch: shortRef(r.defaultBranch)
      })
    }
    return repos.map(toProviderRepo)
  }

  async function listRepos(forceRefresh = false) {
    const cached = cacheStore.get('repos')
    const cachedAt = cacheStore.get('reposCachedAt')
    const cachedMeta = cacheStore.get('reposMeta')

    if (
      !forceRefresh &&
      Array.isArray(cached) &&
      typeof cachedAt === 'number' &&
      Date.now() - cachedAt < TTL_MS
    ) {
      // Восстанавливаем in-memory map из persisted meta (после рестарта
      // приложения slugToRepo пустой, но cache в electron-store жив).
      if (cachedMeta && typeof cachedMeta === 'object' && slugToRepo.size === 0) {
        for (const [slug, meta] of Object.entries(cachedMeta)) {
          slugToRepo.set(slug, meta)
        }
      }
      return cached
    }

    const fresh = await listAllRepos()
    cacheStore.set('repos', fresh)
    cacheStore.set('reposCachedAt', Date.now())
    // Сериализуем slug→meta map в plain object для electron-store.
    const metaPlain = {}
    for (const [slug, meta] of slugToRepo.entries()) {
      metaPlain[slug] = meta
    }
    cacheStore.set('reposMeta', metaPlain)
    return fresh
  }

  async function getRepo(slug) {
    if (!slug || typeof slug !== 'string') return null
    const meta = await resolveRepoMeta(slug)
    if (!meta) return null
    const client = buildClient()
    try {
      const repo = await client.request(
        `/${encodeURIComponent(meta.projectName)}/_apis/git/repositories/${encodeURIComponent(meta.repoId)}`
      )
      return toProviderRepo(repo)
    } catch (e) {
      if (e.status === 404 || e.status === 403) return null
      throw e
    }
  }

  async function getCommits(slug, opts = {}) {
    if (!slug || typeof slug !== 'string') return []
    const meta = await resolveRepoMeta(slug)
    if (!meta) return []
    const o = typeof opts === 'number' ? { pagelen: opts } : opts || {}
    const pagelen = o.pagelen ?? 30
    const branch = o.branch || meta.defaultBranch || null
    const client = buildClient()
    const project = encodeURIComponent(meta.projectName)
    const repoId = encodeURIComponent(meta.repoId)

    let url = `/${project}/_apis/git/repositories/${repoId}/commits?$top=${pagelen}`
    if (branch) {
      url += `&searchCriteria.itemVersion.versionType=branch&searchCriteria.itemVersion.version=${encodeURIComponent(branch)}`
    }

    let data
    try {
      data = await client.request(url)
    } catch (e) {
      if (e.status === 404 || e.status === 403) return []
      throw e
    }
    return (Array.isArray(data?.value) ? data.value : []).map(toCommitShape)
  }

  async function getCommitDetailRaw(slug, hash) {
    const cacheKey = `${slug}:${hash}`
    const cached = commitDetailMemo.get(cacheKey)
    if (cached && Date.now() - cached.ts < COMMIT_DETAIL_TTL_MS) {
      return cached.detail
    }
    const meta = await resolveRepoMeta(slug)
    if (!meta) return null
    const client = buildClient()
    const project = encodeURIComponent(meta.projectName)
    const repoId = encodeURIComponent(meta.repoId)
    const h = encodeURIComponent(hash)

    let detail, changes
    try {
      ;[detail, changes] = await Promise.all([
        client.request(
          `/${project}/_apis/git/repositories/${repoId}/commits/${h}?changeCount=200`
        ),
        client
          .request(
            `/${project}/_apis/git/repositories/${repoId}/commits/${h}/changes?$top=200`
          )
          .catch(() => null)
      ])
    } catch (e) {
      if (e.status === 404 || e.status === 403) return null
      throw e
    }
    const merged = {
      ...detail,
      _changes: Array.isArray(changes?.changes) ? changes.changes : []
    }
    commitDetailMemo.set(cacheKey, { detail: merged, ts: Date.now() })
    return merged
  }

  async function getCommitDetail(slug, hash) {
    if (!slug || !hash) return null
    const detail = await getCommitDetailRaw(slug, hash)
    if (!detail) return null
    const client = buildClient()
    const meta = slugToRepo.get(slug)

    // Azure возвращает changes как массив { changeType, item: { path } }.
    // Без per-file +/- диффа в этом эндпоинте — для статов берём
    // detail.changeCounts (Add/Edit/Delete/Rename count'ы по типам).
    const files = (detail._changes || []).map((c) => ({
      status: mapChangeType(c.changeType),
      // changes-эндпоинт не отдаёт line-counts. UI покажет 0/0 — это
      // приемлемая деградация: BB/GH дают точные числа, AzDO — только
      // список затронутых файлов. Для exact diffs есть отдельный
      // endpoint, но он тяжёлый и не нужен для commit-list summary.
      linesAdded: 0,
      linesRemoved: 0,
      path: c.item?.path?.replace(/^\//, '') || '(unknown)'
    }))

    const counts = detail.changeCounts || {}
    const diffstat = {
      filesChanged: files.length,
      // changeCounts отдаёт {Add, Edit, Delete, Rename, ...} — суммируем.
      linesAdded: 0,
      linesRemoved: 0,
      files,
      truncated: false,
      changeCounts: counts
    }

    return {
      hash: detail.commitId || hash,
      message: typeof detail.comment === 'string' ? detail.comment : '',
      date:
        detail.committer?.date ||
        detail.author?.date ||
        '',
      author:
        detail.author?.name ||
        detail.committer?.name ||
        'unknown',
      authorAccountId: detail.author?.email || null,
      parents: Array.isArray(detail.parents) ? detail.parents : [],
      diffstat,
      url:
        detail.remoteUrl ||
        (meta
          ? `${client.orgUrl}/${encodeURIComponent(meta.projectName)}/_git/${encodeURIComponent(slug)}/commit/${detail.commitId || hash}`
          : '')
    }
  }

  async function getCommitFileDiff(slug, hash, path) {
    // Azure DevOps API не выдаёт unified diff напрямую — есть только
    // pairs blob-id'ов и items'ы. Реализация полноценного diff'а
    // требует двух item-запросов (old + new) и diff-вычисления на
    // нашей стороне. Для MVP возвращаем пустую строку: UI просто
    // покажет без diff-content (как у GH когда file binary).
    if (!slug || !hash || !path) return ''
    return ''
  }

  async function getBranches(slug) {
    if (!slug || typeof slug !== 'string') {
      return { defaultBranch: null, branches: [] }
    }
    const meta = await resolveRepoMeta(slug)
    if (!meta) return { defaultBranch: null, branches: [] }
    const client = buildClient()
    const project = encodeURIComponent(meta.projectName)
    const repoId = encodeURIComponent(meta.repoId)

    let data
    try {
      data = await client.request(
        `/${project}/_apis/git/repositories/${repoId}/refs?filter=heads&$top=500`
      )
    } catch (e) {
      if (e.status === 404 || e.status === 403) {
        return { defaultBranch: meta.defaultBranch, branches: [] }
      }
      throw e
    }
    const refs = Array.isArray(data?.value) ? data.value : []
    const branches = refs
      .map((r) => shortRef(r.name))
      .filter((n) => typeof n === 'string')

    const defaultBranch = meta.defaultBranch
    if (defaultBranch && branches.includes(defaultBranch)) {
      const idx = branches.indexOf(defaultBranch)
      branches.splice(idx, 1)
      branches.unshift(defaultBranch)
    }
    return { defaultBranch, branches }
  }

  async function getBuilds(slug, opts = {}) {
    if (!slug || typeof slug !== 'string') return []
    const meta = await resolveRepoMeta(slug)
    if (!meta) return []
    const pagelen = opts.pagelen ?? 20
    const branch = opts.branch || null
    const client = buildClient()
    const project = encodeURIComponent(meta.projectName)

    let url = `/${project}/_apis/build/builds?repositoryId=${encodeURIComponent(meta.repoId)}&repositoryType=TfsGit&$top=${pagelen}`
    if (branch) {
      url += `&branchName=refs/heads/${encodeURIComponent(branch)}`
    }

    let data
    try {
      data = await client.request(url)
    } catch (e) {
      if (e.status === 404 || e.status === 403) return []
      throw e
    }
    const builds = Array.isArray(data?.value) ? data.value : []
    return builds.map((b) => ({
      uuid: String(b.id),
      buildNumber: b.buildNumber || b.id || 0,
      state: normalizeBuildState(b),
      createdOn: b.queueTime || b.startTime || '',
      completedOn: b.finishTime || null,
      durationSeconds:
        b.startTime && b.finishTime
          ? Math.max(
              0,
              Math.round(
                (new Date(b.finishTime).getTime() -
                  new Date(b.startTime).getTime()) /
                  1000
              )
            )
          : null,
      branch: shortRef(b.sourceBranch),
      commitHash: b.sourceVersion || null,
      author:
        b.requestedFor?.displayName ||
        b.requestedBy?.displayName ||
        'unknown',
      url: b._links?.web?.href || ''
    }))
  }

  async function getBuildSteps(slug, buildId) {
    if (!slug || !buildId) return []
    const meta = await resolveRepoMeta(slug)
    if (!meta) return []
    const client = buildClient()
    const project = encodeURIComponent(meta.projectName)
    const id = encodeURIComponent(buildId)

    let data
    try {
      data = await client.request(
        `/${project}/_apis/build/builds/${id}/timeline`
      )
    } catch (e) {
      if (e.status === 404 || e.status === 403) return []
      throw e
    }
    const records = Array.isArray(data?.records) ? data.records : []
    // Filter top-level Job-records (тип 'Job'). Tasks внутри Job'а
    // отдельно — слишком granular для drawer-таблицы. Если у юзера
    // jobs мало (типичная сборка 1-3 jobs), показываем именно их.
    return records
      .filter((r) => r.type === 'Job')
      .map((r) => ({
        uuid: String(r.id),
        name: r.name || '(unnamed job)',
        state: normalizeBuildState({
          status: r.state,
          result: r.result
        }),
        durationSeconds:
          r.startTime && r.finishTime
            ? Math.max(
                0,
                Math.round(
                  (new Date(r.finishTime).getTime() -
                    new Date(r.startTime).getTime()) /
                    1000
                )
              )
            : null
      }))
  }

  async function getBuildStepLog(slug, buildId, jobUuid) {
    if (!slug || !buildId || !jobUuid) return ''
    const meta = await resolveRepoMeta(slug)
    if (!meta) return ''
    const client = buildClient()
    const project = encodeURIComponent(meta.projectName)
    const bid = encodeURIComponent(buildId)

    // Тяжёлый путь: timeline → найти Job → собрать его log.id +
    // дочерние Task'и → подтянуть лог самого job-record'а. У AzDO
    // job-record имеет log.id, и этот лог содержит aggregate всех
    // Task'ов внутри job. Это и есть наш ответ.
    let timeline
    try {
      timeline = await client.request(
        `/${project}/_apis/build/builds/${bid}/timeline`
      )
    } catch (e) {
      if (e.status === 404 || e.status === 403) return ''
      throw e
    }
    const records = Array.isArray(timeline?.records) ? timeline.records : []
    const job = records.find((r) => String(r.id) === String(jobUuid))
    if (!job?.log?.id) return ''

    try {
      return await client.request(
        `/${project}/_apis/build/builds/${bid}/logs/${encodeURIComponent(job.log.id)}`,
        { asText: true }
      )
    } catch (e) {
      if (e.status === 404 || e.status === 403) return ''
      throw e
    }
  }

  async function getLastCommit(slug) {
    if (!slug || typeof slug !== 'string') return null
    const list = await getCommits(slug, { pagelen: 1 })
    if (list.length === 0) return null
    const c = list[0]
    return {
      message: c.message,
      author: c.author,
      date: c.date,
      hash: c.hash
    }
  }

  function getCloneUrl(slug, gitUsername) {
    const baseUrl = resolveBaseUrl()
    const host = new URL(baseUrl).host
    const org = getWorkspace()
    // У AzDO clone URL всегда такой формат:
    //   https://{user}@dev.azure.com/{org}/{project}/_git/{repo}
    // Без project часть не работает. Берём project из cached map'ы.
    // Если slug ещё не в map'е (не делали list) — fallback на
    // конструкцию без project (юзер увидит понятную ошибку при clone).
    const meta = slugToRepo.get(slug)
    const userPrefix = gitUsername
      ? `${gitUsername}@`
      : getUsername()
      ? `${getUsername()}@`
      : ''
    if (meta) {
      return `https://${userPrefix}${host}/${org}/${encodeURIComponent(meta.projectName)}/_git/${slug}`
    }
    return `https://${userPrefix}${host}/${org}/_git/${slug}`
  }

  function toProviderRepo(repo) {
    // remoteUrl у AzDO имеет формат
    // https://{org}@dev.azure.com/{org}/{project}/_git/{repo} —
    // с user-prefix. Для UI display убираем user-prefix чтобы
    // ссылка была чистая.
    const cleanUrl = (repo.webUrl || repo.remoteUrl || '').replace(
      /^https:\/\/[^@/]+@/,
      'https://'
    )
    return {
      slug: repo.name,
      name: repo.name,
      description: '',
      // У AzDO нет понятия template-репо в Git API, всё 'project'.
      kind: 'project',
      url: cleanUrl,
      cloneUrl: repo.remoteUrl || '',
      updatedOn: null, // AzDO repo не отдаёт last_activity_at; size есть, но не дата
      projectKey: repo.project?.name || ''
    }
  }

  async function listRootFiles(slug) {
    if (!slug || typeof slug !== 'string') return []
    const meta = await resolveRepoMeta(slug)
    if (!meta) return []
    const client = buildClient()
    const project = encodeURIComponent(meta.projectName)
    const repoId = encodeURIComponent(meta.repoId)

    try {
      const data = await client.request(
        `/${project}/_apis/git/repositories/${repoId}/items?scopePath=/&recursionLevel=OneLevel`
      )
      const items = Array.isArray(data?.value) ? data.value : []
      // Возвращаем только имена топ-уровневых entry'ев (без сам '/' root).
      return items
        .filter((it) => it.path && it.path !== '/')
        .map((it) => {
          const p = it.path.replace(/^\/+/, '')
          // path для root-листинга = "filename" или "subdir" — без слэшей
          // глубже. На всякий случай отрезаем path-prefix если он есть.
          const idx = p.lastIndexOf('/')
          return idx >= 0 ? p.slice(idx + 1) : p
        })
        .filter(Boolean)
    } catch (e) {
      if (e.status === 404 || e.status === 403) return []
      throw e
    }
  }

  async function getFileText(slug, filePath) {
    if (!slug || !filePath) return null
    const meta = await resolveRepoMeta(slug)
    if (!meta) return null
    const client = buildClient()
    const project = encodeURIComponent(meta.projectName)
    const repoId = encodeURIComponent(meta.repoId)
    const cleanPath = '/' + filePath.replace(/^\/+/, '')

    try {
      // ?download=true&$format=octetStream + asText → AzDO отдаёт сырой
      // контент файла text'ом. Без `download=true` отдаёт metadata-JSON.
      return await client.request(
        `/${project}/_apis/git/repositories/${repoId}/items?path=${encodeURIComponent(cleanPath)}&download=true&$format=octetStream`,
        { asText: true }
      )
    } catch (e) {
      if (e.status === 404 || e.status === 403) return null
      throw e
    }
  }

  return {
    type: 'azure',
    capabilities: {
      builds: true,
      branches: true,
      commits: true,
      // commit file-diff пока не реализован (см. getCommitFileDiff
      // комментарий) — UI покажет пустой diff. Capabilities-флаг
      // оставляем true чтобы summary с filenames всё равно отдавался.
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
 * Combined status + result → нормализованный state приложения.
 *   status:  notStarted, inProgress, completed, cancelling, postponed, none
 *   result:  succeeded, partiallySucceeded, failed, canceled, none
 */
function normalizeBuildState(b) {
  if (!b) return 'PENDING'
  const status = b.status
  const result = b.result
  if (
    status === 'notStarted' ||
    status === 'postponed' ||
    status === 'pending' ||
    status === 'none'
  ) {
    return 'PENDING'
  }
  if (status === 'inProgress' || status === 'cancelling') {
    return 'IN_PROGRESS'
  }
  if (status === 'completed') {
    switch (result) {
      case 'succeeded':
        return 'SUCCESSFUL'
      case 'partiallySucceeded':
        return 'SUCCESSFUL'
      case 'failed':
        return 'FAILED'
      case 'canceled':
        return 'STOPPED'
      default:
        return 'PENDING'
    }
  }
  return 'PENDING'
}

function mapChangeType(t) {
  if (!t) return 'modified'
  // AzDO change-type значения: add, edit, delete, rename, branch, etc.
  if (t.includes('add')) return 'added'
  if (t.includes('delete')) return 'removed'
  if (t.includes('rename')) return 'renamed'
  return 'modified'
}

function toCommitShape(c) {
  return {
    hash: c.commitId || '',
    message: typeof c.comment === 'string' ? c.comment : '',
    date:
      c.committer?.date ||
      c.author?.date ||
      '',
    author:
      c.author?.name ||
      c.committer?.name ||
      'unknown',
    authorAccountId: c.author?.email || null,
    parents: Array.isArray(c.parents) ? c.parents : []
  }
}
