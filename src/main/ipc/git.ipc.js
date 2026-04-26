import { ipcMain } from 'electron'
import * as gitService from '../services/git-service.js'

export function registerGitIpc() {
  ipcMain.handle('git:clone', (_event, slug) => gitService.clone(slug))
  ipcMain.handle('git:pull', (_event, slug) => gitService.pull(slug))
  ipcMain.handle('git:status', (_event, slug) => gitService.status(slug))
  ipcMain.handle('git:branches', (_event, slug) => gitService.branches(slug))
  ipcMain.handle('git:checkout', (_event, slug, branch) =>
    gitService.checkout(slug, branch)
  )
}
