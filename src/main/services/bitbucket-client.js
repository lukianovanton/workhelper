/**
 * Тонкий shim над `vcs/bitbucket-provider.js`.
 *
 * Phase A.1 рефакторинг: вся реальная логика переехала в provider.
 * Этот файл существует чтобы IPC-слой и enrich.js остались без
 * изменений — они продолжают `import { listProjects, ... } from
 * './bitbucket-client.js'`.
 *
 * Здесь:
 *  - держим singleton-инстанс `BitbucketProvider` (он stateless,
 *    каждый его метод сам читает свежий config; лень-инициализация
 *    избавляет от циркулярных импортов в момент загрузки модуля)
 *  - оборачиваем generic ProviderRepo обратно в полную Project-форму
 *    (с полем `bitbucket: {}`), которую ожидает остальной код. В
 *    Phase A.3 эта форма уйдёт, и shim превратится в чистый
 *    делегат без маппинга.
 *
 * Имя экспортов и сигнатуры идентичны исходным, поэтому диф
 * импортов в IPC = ноль.
 *
 * @typedef {import('../../shared/types.js').Project} Project
 * @typedef {import('./vcs/types.js').ProviderRepo} ProviderRepo
 * @typedef {import('./vcs/types.js').VcsProvider} VcsProvider
 */

import { createBitbucketProvider } from './vcs/bitbucket-provider.js'

/** @type {VcsProvider | null} */
let _provider = null

function provider() {
  if (!_provider) _provider = createBitbucketProvider()
  return _provider
}

export function testConnection() {
  return provider().testConnection()
}

/**
 * Полный список репо без кэша. Используется внутри listProjects;
 * экспортируем потому что один out-of-tree вызов остался в тестах
 * чекпоинтов — на всякий случай.
 *
 * @returns {Promise<Project[]>}
 */
export async function listRepositories() {
  const repos = await provider().listRepos(true)
  return repos.map(toProjectShape)
}

/**
 * Список проектов с кэшем. Кэш живёт внутри provider.listRepos.
 *
 * @param {boolean} forceRefresh
 * @returns {Promise<Project[]>}
 */
export async function listProjects(forceRefresh = false) {
  const repos = await provider().listRepos(forceRefresh)
  return repos.map(toProjectShape)
}

export function getCommits(slug, opts) {
  return provider().getCommits(slug, opts)
}

export function getCommitDetail(slug, hash) {
  return provider().getCommitDetail(slug, hash)
}

export function getCommitFileDiff(slug, hash, path) {
  return provider().getCommitFileDiff(slug, hash, path)
}

export function getBranches(slug) {
  return provider().getBranches(slug)
}

export function getPipelines(slug, opts) {
  return provider().getBuilds(slug, opts)
}

export function getPipelineSteps(slug, pipelineUuid) {
  return provider().getBuildSteps(slug, pipelineUuid)
}

export function getPipelineStepLog(slug, pipelineUuid, stepUuid) {
  return provider().getBuildStepLog(slug, pipelineUuid, stepUuid)
}

export function getLastCommit(slug) {
  return provider().getLastCommit(slug)
}

/**
 * Маппинг generic ProviderRepo → Project (текущая форма с
 * полем `bitbucket: {}`). Local/db/runtime заполняются нулевыми
 * значениями — enrichProjects подтягивает реальные.
 *
 * Будет удалён в Phase A.3 при reshape модели.
 *
 * @param {ProviderRepo} repo
 * @returns {Project}
 */
function toProjectShape(repo) {
  const slugLower = (repo.slug || '').toLowerCase()
  return {
    slug: repo.slug,
    name: repo.name,
    description: repo.description || '',
    kind: repo.kind,
    bitbucket: {
      url: repo.url,
      cloneUrl: repo.cloneUrl,
      updatedOn: repo.updatedOn,
      projectKey: repo.projectKey || ''
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
