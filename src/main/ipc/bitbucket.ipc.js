import { ipcMain } from 'electron'
import {
  listProjects,
  testConnection
} from '../services/bitbucket-client.js'

/**
 * Регистрация bitbucket:* IPC-каналов.
 *
 *  - bitbucket:list      кэшированный список (TTL 10 мин)
 *  - bitbucket:refresh   принудительный обход кэша
 *  - bitbucket:test      двухступенчатая проверка (auth + workspace access)
 */
export function registerBitbucketIpc() {
  ipcMain.handle('bitbucket:list', () => listProjects(false))
  ipcMain.handle('bitbucket:refresh', () => listProjects(true))
  ipcMain.handle('bitbucket:test', () => testConnection())
}
