import { registerConfigIpc } from './config.ipc.js'

/**
 * Регистрация всех IPC-хендлеров. Вызывается из main/index.js
 * после app.whenReady() — safeStorage и app.getPath() требуют готовности.
 */
export function registerAllIpc() {
  registerConfigIpc()
  // bitbucket / git / db / fs / process / editor — следующие чекпоинты
}
