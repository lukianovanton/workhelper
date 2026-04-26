import { registerConfigIpc } from './config.ipc.js'
import { registerBitbucketIpc } from './bitbucket.ipc.js'
import { registerDbIpc } from './db.ipc.js'

/**
 * Регистрация всех IPC-хендлеров. Вызывается из main/index.js
 * после app.whenReady() — safeStorage и app.getPath() требуют готовности.
 */
export function registerAllIpc() {
  registerConfigIpc()
  registerBitbucketIpc()
  registerDbIpc()
  // git / fs / process / editor — следующие чекпоинты
}
