import { ipcMain, BrowserWindow } from 'electron'
import * as processManager from '../services/process-manager.js'

/**
 * Регистрация process:* IPC и проброс event-эмиттера в process-manager.
 *
 * События от main к renderer:
 *   - process:log   { slug, chunk, stream }   — для будущего Logs tab
 *   - process:port  { slug, port }            — обнаружен порт в stdout
 *   - process:exit  { slug, code, signal }    — процесс завершился
 *
 * Renderer в MVP-1 поллит process:list каждые 2с, события используются
 * для подписки в Logs tab (MVP-2/3).
 */
export function registerProcessIpc() {
  processManager.setEmitter((event, payload) => {
    const channel = `process:${event}`
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.webContents.isDestroyed()) {
        win.webContents.send(channel, payload)
      }
    }
  })

  ipcMain.handle('process:run', (_event, slug) => processManager.run(slug))
  ipcMain.handle('process:stop', (_event, slug) => processManager.stop(slug))
  ipcMain.handle('process:isRunning', (_event, slug) =>
    processManager.isRunning(slug)
  )
  ipcMain.handle('process:list', () => processManager.list())
  ipcMain.handle('process:logs', (_event, slug) => processManager.logs(slug))
}
