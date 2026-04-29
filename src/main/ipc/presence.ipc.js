import { ipcMain } from 'electron'
import * as presence from '../services/presence-service.js'

/**
 *  - presence:list         снимок активных сессий из локалки
 *  - presence:setEnabled   включить/выключить presence на лету
 *                           (true → start UDP, false → close socket)
 *  - presence:isEnabled    текущий статус
 */
export function registerPresenceIpc() {
  ipcMain.handle('presence:list', () => presence.getSessions())
  ipcMain.handle('presence:isEnabled', () => presence.isPresenceEnabled())
  ipcMain.handle('presence:setEnabled', (_event, on) => {
    if (on) presence.startPresence()
    else presence.stopPresence()
    return presence.isPresenceEnabled()
  })
}
