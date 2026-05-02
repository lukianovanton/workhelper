import { ipcMain } from 'electron'
import {
  getMeta,
  setMeta
} from '../services/projects-meta-store.js'

/**
 * IPC для projects-meta (favorites / recent / notes / categories /
 * jiraBindings). Бэкенд — electron-store в userData. Renderer-store
 * подписан через api.meta.{get,set}.
 */
export function registerMetaIpc() {
  ipcMain.handle('meta:get', () => getMeta())
  ipcMain.handle('meta:set', (_event, patch) => {
    setMeta(patch)
    return { ok: true }
  })
}
