import { ipcMain, shell } from 'electron'

/**
 * Разные мелкие функции уровня OS, не вписывающиеся в специализированные
 * сервисы.
 *
 *  - app:openFolder — открыть путь в системном файловом менеджере
 *    (Explorer на Windows). Используется кнопкой Open folder в drawer.
 */
export function registerAppIpc() {
  ipcMain.handle('app:openFolder', async (_event, dirPath) => {
    if (!dirPath || typeof dirPath !== 'string') {
      throw new Error('Path is required')
    }
    const errMsg = await shell.openPath(dirPath)
    if (errMsg) {
      // shell.openPath возвращает '' на успех или сообщение об ошибке
      throw new Error(errMsg)
    }
    return { ok: true }
  })
}
