import { BrowserWindow, ipcMain } from 'electron'
import * as dbService from '../services/db-service.js'

/**
 * MVP-2 destructive ops:
 *  - db:test     — пинг подключения (Settings)
 *  - db:create   — CREATE DATABASE
 *  - db:drop     — DROP DATABASE (renderer закрывает AlertDialog'ом)
 *  - db:restore  — стримящий restore из дампа.
 *                   Прогресс эмитится через db:restore-event:
 *                     { slug, kind: 'start',    totalBytes }
 *                     { slug, kind: 'progress', bytesRead, totalBytes }
 *                     { slug, kind: 'done',     bytesRead, totalBytes, durationMs, dumpFile }
 *                     { slug, kind: 'error',    message }
 *                   Renderer держит состояние в zustand store, чтобы
 *                   прогресс переживал mount/unmount drawer'а.
 *
 * exists/size живут внутри enrich-пайплайна — отдельные IPC не делаем.
 */
function broadcast(channel, payload) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.webContents.isDestroyed()) {
      win.webContents.send(channel, payload)
    }
  }
}

export function registerDbIpc() {
  ipcMain.handle('db:test', () => dbService.testConnection())
  ipcMain.handle('db:create', (_event, name) =>
    dbService.createDatabase(name)
  )
  ipcMain.handle('db:drop', (_event, name) => dbService.dropDatabase(name))

  ipcMain.handle('db:restore', async (_event, { slug, dumpPath }) => {
    const name = (slug || '').toLowerCase()
    broadcast('db:restore-event', {
      slug,
      kind: 'start',
      totalBytes: 0 // будет уточнено в первом progress
    })
    try {
      const result = await dbService.restoreDatabase(
        name,
        dumpPath,
        slug,
        (progress) => {
          broadcast('db:restore-event', {
            slug,
            kind: 'progress',
            bytesRead: progress.bytesRead,
            totalBytes: progress.totalBytes
          })
        }
      )
      broadcast('db:restore-event', {
        slug,
        kind: 'done',
        bytesRead: result.bytesRead,
        totalBytes: result.totalBytes,
        durationMs: result.durationMs,
        dumpFile: result.dumpFile
      })
      return result
    } catch (e) {
      broadcast('db:restore-event', {
        slug,
        kind: 'error',
        message: e?.message || String(e)
      })
      throw e
    }
  })

  ipcMain.handle('db:isRestoring', (_event, slug) =>
    dbService.isRestoring(slug)
  )
}
