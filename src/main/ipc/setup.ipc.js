import { BrowserWindow, ipcMain } from 'electron'
import * as orchestrator from '../services/setup-orchestrator.js'

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
    async (_event, { slug, dumpPath, skipRestore, runAfter }) => {
      broadcast('setup:event', { slug, kind: 'started' })
      try {
        await orchestrator.runFull(
          slug,
          { dumpPath, skipRestore, runAfter },
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
}
