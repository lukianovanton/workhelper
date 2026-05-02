import { ipcMain } from 'electron'
import {
  getProvider,
  getProviderForSlug,
  listAllRepos,
  listSources
} from '../services/vcs/registry.js'
import { enrichProjects } from '../services/enrich.js'

/**
 * VCS IPC: переименован из bitbucket:* (legacy). Каналы теперь
 * provider-agnostic, маршрутизация по slug → provider.
 *
 *  - vcs:projects:list      кэшированный обход всех source'ов + enrich
 *  - vcs:projects:refresh   принудительный обход + enrich
 *  - vcs:test               testConnection дефолтного source
 *                           (удобно для smoke-test без указания id)
 *  - vcs:commits / vcs:commit-detail / vcs:commit-file-diff /
 *    vcs:branches / vcs:lastCommit  — per-slug, через registry
 *  - vcs:builds / vcs:build-steps / vcs:build-step-log
 *    (на BB: pipelines, на GH: Actions runs)
 *
 * Возвращаемые формы — те же что у провайдера, см. vcs/types.js.
 */
function safeProviderCall(slug, methodName, fallback, ...args) {
  const provider = getProviderForSlug(slug)
  if (!provider || typeof provider[methodName] !== 'function') {
    return Promise.resolve(fallback)
  }
  return provider[methodName](...args)
}

export function registerVcsIpc() {
  ipcMain.handle('vcs:projects:list', async () => {
    const items = await listAllRepos(false)
    const projects = items.map(toProjectShape)
    return enrichProjects(projects)
  })

  ipcMain.handle('vcs:projects:refresh', async () => {
    const items = await listAllRepos(true)
    const projects = items.map(toProjectShape)
    return enrichProjects(projects)
  })

  ipcMain.handle('vcs:test', async () => {
    // Smoke-test всех source'ов параллельно. Возвращает массив
    // { sourceId, sourceName, sourceType, result } чтобы UI мог
    // показать состояние каждого. Для теста конкретного подключения
    // используется sources:test(id).
    const sources = listSources()
    if (sources.length === 0) {
      return {
        ok: false,
        stage: 'config',
        message: 'No VCS source configured.',
        sources: []
      }
    }
    const results = await Promise.all(
      sources.map(async (s) => {
        const provider = getProvider(s.id)
        if (!provider) {
          return {
            sourceId: s.id,
            sourceName: s.name,
            sourceType: s.type,
            result: { ok: false, stage: 'config', message: 'Provider not built' }
          }
        }
        try {
          const result = await provider.testConnection()
          return {
            sourceId: s.id,
            sourceName: s.name,
            sourceType: s.type,
            result
          }
        } catch (e) {
          return {
            sourceId: s.id,
            sourceName: s.name,
            sourceType: s.type,
            result: { ok: false, stage: 'http', message: e?.message || String(e) }
          }
        }
      })
    )
    const allOk = results.every((r) => r.result.ok)
    return { ok: allOk, sources: results }
  })

  ipcMain.handle('vcs:lastCommit', (_event, slug) =>
    safeProviderCall(slug, 'getLastCommit', null, slug)
  )

  ipcMain.handle('vcs:commits', (_event, slug, opts) =>
    safeProviderCall(slug, 'getCommits', [], slug, opts)
  )

  ipcMain.handle('vcs:commit-detail', (_event, slug, hash) =>
    safeProviderCall(slug, 'getCommitDetail', null, slug, hash)
  )

  ipcMain.handle('vcs:commit-file-diff', (_event, slug, hash, path) =>
    safeProviderCall(slug, 'getCommitFileDiff', '', slug, hash, path)
  )

  ipcMain.handle('vcs:branches', (_event, slug) =>
    safeProviderCall(
      slug,
      'getBranches',
      { defaultBranch: null, branches: [] },
      slug
    )
  )

  ipcMain.handle('vcs:builds', (_event, slug, opts) =>
    safeProviderCall(slug, 'getBuilds', [], slug, opts)
  )

  ipcMain.handle('vcs:build-steps', (_event, slug, buildUuid) =>
    safeProviderCall(slug, 'getBuildSteps', [], slug, buildUuid)
  )

  ipcMain.handle('vcs:build-step-log', (_event, slug, buildUuid, stepUuid) =>
    safeProviderCall(slug, 'getBuildStepLog', '', slug, buildUuid, stepUuid)
  )
}

/**
 * Маппинг {sourceId, sourceType, repo} → Project. Source.type попадает
 * в shape чтобы UI мог рисовать бейдж GH/BB без отдельного запроса.
 */
function toProjectShape({ sourceId, sourceType, sourceName, repo }) {
  const slugLower = (repo.slug || '').toLowerCase()
  return {
    slug: repo.slug,
    name: repo.name,
    description: repo.description || '',
    kind: repo.kind,
    source: {
      providerId: sourceId,
      type: sourceType,
      name: sourceName || sourceType,
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
