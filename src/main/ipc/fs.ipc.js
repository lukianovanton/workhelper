import { BrowserWindow, dialog, ipcMain } from 'electron'
import os from 'node:os'
import { getConfig } from '../services/config-store.js'

/**
 * fs:pickDump — нативный диалог выбора файла дампа.
 * Дефолтная папка — config.paths.dumpsRoot если задана, иначе домашняя.
 * Без фильтров по расширению: дампы у пользователя приходят с
 * нерегулярными именами (`dump-P0070-2026-04-01` и т.п.). Формат
 * (gzip vs plain) определяется content-based в restoreDatabase.
 */
export function registerFsIpc() {
  ipcMain.handle('fs:pickDump', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const defaultPath = getConfig().paths.dumpsRoot || os.homedir()

    const result = await dialog.showOpenDialog(win, {
      title: 'Select dump file',
      defaultPath,
      properties: ['openFile']
    })

    if (result.canceled) return null
    return result.filePaths?.[0] || null
  })
}
