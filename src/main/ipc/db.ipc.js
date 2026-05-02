import { BrowserWindow, ipcMain } from 'electron'
import { resolveProjectDb } from '../services/db/registry.js'

/**
 * DB ops роутятся per-project: каждый IPC принимает slug, мы резолвим
 * (engine + dbName) через config.databaseOverrides → registry.
 *
 * Прогресс restore эмитится через db:restore-event:
 *   { slug, kind: 'start',    totalBytes }
 *   { slug, kind: 'progress', bytesRead, totalBytes }
 *   { slug, kind: 'done',     bytesRead, totalBytes, durationMs, dumpFile }
 *   { slug, kind: 'error',    message }
 *
 * exists/size живут внутри enrich — отдельные IPC не делаем.
 */
function broadcast(channel, payload) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.webContents.isDestroyed()) {
      win.webContents.send(channel, payload)
    }
  }
}

function resolveOrThrow(slug) {
  const r = resolveProjectDb(slug)
  if (!r.engine) {
    throw new Error(
      'No database engine configured. Open Settings → Databases.'
    )
  }
  return r
}

export function registerDbIpc() {
  // db:test — back-compat, тестирует default engine. Современный путь —
  // databases:test(id) для конкретного подключения. Этот endpoint
  // оставлен на случай вызовов из старых частей UI.
  ipcMain.handle('db:test', () => {
    const r = resolveProjectDb('') // slug не нужен — берём default
    if (!r.engine) {
      return Promise.resolve({
        ok: false,
        message: 'No database engine configured.'
      })
    }
    return r.engine.testConnection()
  })

  ipcMain.handle('db:create', (_event, slug) => {
    const { engine, dbName } = resolveOrThrow(slug)
    return engine.createDatabase(dbName)
  })

  ipcMain.handle('db:drop', (_event, slug) => {
    const { engine, dbName } = resolveOrThrow(slug)
    return engine.dropDatabase(dbName)
  })

  ipcMain.handle('db:restore', async (_event, { slug, dumpPath }) => {
    const { engine, dbName } = resolveOrThrow(slug)
    broadcast('db:restore-event', {
      slug,
      kind: 'start',
      totalBytes: 0 // будет уточнено в первом progress
    })
    try {
      const result = await engine.restoreDatabase(
        dbName,
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

  ipcMain.handle('db:isRestoring', (_event, slug) => {
    const { engine } = resolveProjectDb(slug)
    return engine ? engine.isRestoring(slug) : false
  })
}
