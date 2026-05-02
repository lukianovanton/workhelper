import { BrowserWindow, ipcMain } from 'electron'
import * as orchestrator from '../services/setup-orchestrator.js'
import * as fsService from '../services/fs-service.js'
import { getConfig } from '../services/config-store.js'
import { getProviderForSlug } from '../services/vcs/registry.js'

/**
 * setup:run-full        — стартует оркестрацию clone → db-create →
 *                         db-restore → workspace → (run если runAfter)
 * setup:cancel          — выставляет cancel-флаг + kill активного restore
 * setup:is-active       — синхронная проверка для UI (recovery после mount)
 *
 * Стрим шагов через setup:step-event:
 *   { slug, step: { kind, status, percent?, durationMs?, message? } }
 *
 * Отдельные события 'cancelled' / 'finished' / 'failed' эмитим как
 * top-level статусы — drawer переключает phase.
 */
function broadcast(channel, payload) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.webContents.isDestroyed()) {
      win.webContents.send(channel, payload)
    }
  }
}

export function registerSetupIpc() {
  ipcMain.handle(
    'setup:run-full',
    async (
      _event,
      { slug, dumpPath, skipRestore, skipDb, openWorkspace, runAfter }
    ) => {
      broadcast('setup:event', { slug, kind: 'started' })
      try {
        await orchestrator.runFull(
          slug,
          { dumpPath, skipRestore, skipDb, openWorkspace, runAfter },
          (step) => broadcast('setup:event', { slug, kind: 'step', step })
        )
        broadcast('setup:event', { slug, kind: 'finished' })
        return { ok: true }
      } catch (e) {
        if (e?.cancelled) {
          broadcast('setup:event', { slug, kind: 'cancelled' })
          return { ok: false, cancelled: true }
        }
        broadcast('setup:event', {
          slug,
          kind: 'failed',
          message: e?.message || String(e)
        })
        throw e
      }
    }
  )

  ipcMain.handle('setup:cancel', (_event, slug) =>
    orchestrator.cancelSetup(slug)
  )

  ipcMain.handle('setup:is-active', (_event, slug) =>
    orchestrator.isSetupActive(slug)
  )

  // Авто-детект стека: smart-defaults для SetupDialog.
  //   - Локальный путь (если проект клонирован): inspect файлы на диске.
  //   - Remote путь (проект ещё не клонирован): через VcsProvider
  //     забираем root-listing и нужные манифесты, применяем те же
  //     эвристики. Для .NET cwd через REST не считаем — после клона
  //     локальный детектор уточнит.
  ipcMain.handle('setup:detectStack', async (_event, slug) => {
    if (!slug || typeof slug !== 'string') {
      return {
        stackKind: null,
        runCommand: null,
        cwd: '',
        needsDatabase: false
      }
    }
    const root = getConfig().paths?.projectsRoot
    if (root && fsService.projectExists(root, slug)) {
      return fsService.detectStack(fsService.projectPath(root, slug))
    }
    const provider = getProviderForSlug(slug)
    if (!provider) {
      return {
        stackKind: null,
        runCommand: null,
        cwd: '',
        needsDatabase: false
      }
    }
    return fsService.detectStackRemote(provider, slug)
  })
}
