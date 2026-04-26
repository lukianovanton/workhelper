import { ipcMain } from 'electron'
import * as dbService from '../services/db-service.js'

/**
 * MVP-2 добавляет destructive операции:
 *  - db:create — CREATE DATABASE с utf8mb4
 *  - db:drop   — DROP DATABASE (необратимо, в renderer стоит AlertDialog)
 *
 * exists/size живут внутри enrich-пайплайна, отдельные IPC не делаем
 * пока нет сценария "позови размер БД для одного слага".
 */
export function registerDbIpc() {
  ipcMain.handle('db:test', () => dbService.testConnection())
  ipcMain.handle('db:create', (_event, name) =>
    dbService.createDatabase(name)
  )
  ipcMain.handle('db:drop', (_event, name) => dbService.dropDatabase(name))
}
