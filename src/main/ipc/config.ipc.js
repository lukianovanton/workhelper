import { ipcMain } from 'electron'
import * as configStore from '../services/config-store.js'
import * as secrets from '../services/secrets.js'
import { whichBinary } from '../services/path-detect.js'

/**
 * Регистрация config:* IPC-каналов.
 * Вызывается один раз из main/index.js после app.whenReady().
 */
export function registerConfigIpc() {
  ipcMain.handle('config:get', () => configStore.getConfig())

  ipcMain.handle('config:set', (_event, patch) => {
    configStore.setConfig(patch)
  })

  ipcMain.handle('config:setSecret', (_event, key, value) => {
    secrets.setSecret(key, value)
  })

  ipcMain.handle('config:clearSecret', (_event, key) => {
    secrets.clearSecret(key)
  })

  ipcMain.handle('config:secretsStatus', () => secrets.secretsStatus())

  ipcMain.handle('config:whichBinary', (_event, name) => whichBinary(name))
}
