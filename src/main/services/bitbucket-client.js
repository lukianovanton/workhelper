/**
 * Тонкий shim над VCS-registry.
 *
 * Phase A.4a: реальная маршрутизация переехала в `vcs/registry.js`.
 * Этот файл существует чтобы IPC-слой и enrich.js остались без
 * изменений — они продолжают `import { listProjects, ... } from
 * './bitbucket-client.js'`.
 *
 * Каждый метод per-slug резолвит провайдера через
 * `registry.getProviderForSlug(slug)` — на момент A.4a это
 * единственный default BB-source, в A.4b начнёт находить нужный
 * source среди нескольких.
 *
 * @typedef {import('../../shared/types.js').Project} Project
 * @typedef {import('./vcs/types.js').ProviderRepo} ProviderRepo
 */

import {
  getProvider,
  getProviderForSlug,
  listAllRepos as registryListAllRepos
} from './vcs/registry.js'

const DEFAULT_BB_SOURCE_ID = 'bitbucket-default'

/**
 * Тестируем дефолтный source. В A.4b появится новый IPC `sources:test`
 * который тестит конкретный source по id. Этот шорткат остаётся для
 * совместимости (`bitbucket:test` IPC).
 */
export function testConnection() {
  const provider = getProvider(DEFAULT_BB_SOURCE_ID)
  if (!provider) {
    return Promise.resolve({
      ok: false,
      stage: 'config',
      message: 'No Bitbucket source configured.'
    })
  }
  return provider.testConnection()
}

/**
 * Полный список репо без кэша. Используется только тестами чекпоинтов.
 *
 * @returns {Promise<Project[]>}
 */
export async function listRepositories() {
  const items = await registryListAllRepos(true)
  return items.map(toProjectShape)
}

/**
 * Список проектов с кэшем. Кэш живёт per-source внутри provider.listRepos.
 *
 * @param {boolean} forceRefresh
 * @returns {Promise<Project[]>}
 */
export async function listProjects(forceRefresh = false) {
  const items = await registryListAllRepos(forceRefresh)
  return items.map(toProjectShape)
}

export function getCommits(slug, opts) {
  const provider = getProviderForSlug(slug)
  return provider ? provider.getCommits(slug, opts) : Promise.resolve([])
}

export function getCommitDetail(slug, hash) {
  const provider = getProviderForSlug(slug)
  return provider ? provider.getCommitDetail(slug, hash) : Promise.resolve(null)
}

export function getCommitFileDiff(slug, hash, path) {
  const provider = getProviderForSlug(slug)
  return provider
    ? provider.getCommitFileDiff(slug, hash, path)
    : Promise.resolve('')
}

export function getBranches(slug) {
  const provider = getProviderForSlug(slug)
  return provider
    ? provider.getBranches(slug)
    : Promise.resolve({ defaultBranch: null, branches: [] })
}

export function getPipelines(slug, opts) {
  const provider = getProviderForSlug(slug)
  return provider ? provider.getBuilds(slug, opts) : Promise.resolve([])
}

export function getPipelineSteps(slug, pipelineUuid) {
  const provider = getProviderForSlug(slug)
  return provider
    ? provider.getBuildSteps(slug, pipelineUuid)
    : Promise.resolve([])
}

export function getPipelineStepLog(slug, pipelineUuid, stepUuid) {
  const provider = getProviderForSlug(slug)
  return provider
    ? provider.getBuildStepLog(slug, pipelineUuid, stepUuid)
    : Promise.resolve('')
}

export function getLastCommit(slug) {
  const provider = getProviderForSlug(slug)
  return provider ? provider.getLastCommit(slug) : Promise.resolve(null)
}

/**
 * Маппинг {sourceId, repo} → Project. Source.providerId фиксируется
 * на конкретном source'е, проброшенном из реестра.
 *
 * @param {{ sourceId: string, repo: ProviderRepo }} item
 * @returns {Project}
 */
function toProjectShape({ sourceId, repo }) {
  const slugLower = (repo.slug || '').toLowerCase()
  return {
    slug: repo.slug,
    name: repo.name,
    description: repo.description || '',
    kind: repo.kind,
    source: {
      providerId: sourceId,
      repoSlug: repo.slug,
      providerData: repo.projectKey ? { projectKey: repo.projectKey } : {}
    },
    url: repo.url,
    cloneUrl: repo.cloneUrl,
    updatedOn: repo.updatedOn,
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
