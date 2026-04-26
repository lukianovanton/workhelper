import { ipcMain } from 'electron'
import * as gitService from '../services/git-service.js'

export function registerGitIpc() {
  ipcMain.handle('git:pull', (_event, slug) => gitService.pull(slug))
  ipcMain.handle('git:status', (_event, slug) => gitService.status(slug))
}
