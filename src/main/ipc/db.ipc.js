import { ipcMain } from 'electron'
import * as dbService from '../services/db-service.js'

/**
 * MVP-1 нужны только: db:test (Settings → Database → Test).
 * exists/size живут внутри enrich-пайплайна, отдельные IPC не делаем
 * пока нет сценария "позови размер БД для одного слага".
 */
export function registerDbIpc() {
  ipcMain.handle('db:test', () => dbService.testConnection())
}
