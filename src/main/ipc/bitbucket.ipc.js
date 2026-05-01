import { ipcMain } from 'electron'
import {
  listProjects,
  testConnection,
  getLastCommit,
  getCommits,
  getCommitDetail,
  getCommitFileDiff,
  getPipelines,
  getPipelineSteps,
  getPipelineStepLog,
  getBranches
} from '../services/bitbucket-client.js'
import { enrichProjects } from '../services/enrich.js'

/**
 * Регистрация bitbucket:* IPC-каналов.
 *
 *  - bitbucket:list      кэшированный raw + свежий enrich
 *  - bitbucket:refresh   принудительный обход bitbucket-кэша + enrich
 *  - bitbucket:test      двухступенчатая проверка (auth + workspace access)
 *
 * Bitbucket-данные кэшируются на 10 мин, enrich (fs/db) считается заново
 * на каждый вызов — состояние локального диска и БД меняется чаще.
 *
 * Возвращает { projects, warnings }: warnings — мягкие сообщения от
 * enrich (например, «MySQL недоступен»), которые UI показывает как
 * info-bar, не блокируя работу.
 */
export function registerBitbucketIpc() {
  ipcMain.handle('bitbucket:list', async () => {
    const raw = await listProjects(false)
    return enrichProjects(raw)
  })
  ipcMain.handle('bitbucket:refresh', async () => {
    const raw = await listProjects(true)
    return enrichProjects(raw)
  })
  ipcMain.handle('bitbucket:test', () => testConnection())
  ipcMain.handle('bitbucket:lastCommit', (_event, slug) =>
    getLastCommit(slug)
  )
  ipcMain.handle('bitbucket:commits', (_event, slug, opts) =>
    getCommits(slug, opts)
  )
  ipcMain.handle('bitbucket:commit-detail', (_event, slug, hash) =>
    getCommitDetail(slug, hash)
  )
  ipcMain.handle(
    'bitbucket:commit-file-diff',
    (_event, slug, hash, path) => getCommitFileDiff(slug, hash, path)
  )
  ipcMain.handle('bitbucket:pipelines', (_event, slug, opts) =>
    getPipelines(slug, opts)
  )
  ipcMain.handle('bitbucket:pipeline-steps', (_event, slug, pipelineUuid) =>
    getPipelineSteps(slug, pipelineUuid)
  )
  ipcMain.handle(
    'bitbucket:pipeline-step-log',
    (_event, slug, pipelineUuid, stepUuid) =>
      getPipelineStepLog(slug, pipelineUuid, stepUuid)
  )
  ipcMain.handle('bitbucket:branches', (_event, slug) => getBranches(slug))
}
