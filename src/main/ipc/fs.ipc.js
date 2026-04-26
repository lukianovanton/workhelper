import { BrowserWindow, dialog, ipcMain } from 'electron'
import os from 'node:os'
import { getConfig } from '../services/config-store.js'

/**
 * fs:pickDump — нативный диалог выбора SQL-дампа.
 * Дефолтная папка — config.paths.dumpsRoot если задана, иначе домашняя.
 * Filters принимают .sql и .gz; реальная валидация (.sql / .sql.gz)
 * идёт в db-service.restoreDatabase.
 */
export function registerFsIpc() {
  ipcMain.handle('fs:pickDump', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const defaultPath = getConfig().paths.dumpsRoot || os.homedir()

    const result = await dialog.showOpenDialog(win, {
      title: 'Select SQL dump',
      defaultPath,
      properties: ['openFile'],
      filters: [
        { name: 'SQL dumps', extensions: ['sql', 'gz'] },
        { name: 'All files', extensions: ['*'] }
      ]
    })

    if (result.canceled) return null
    return result.filePaths?.[0] || null
  })
}
