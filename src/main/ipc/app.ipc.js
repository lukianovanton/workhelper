import { ipcMain, shell } from 'electron'
import { rm } from 'node:fs/promises'
import * as processManager from '../services/process-manager.js'
import {
  projectExists,
  projectPath
} from '../services/fs-service.js'
import { getConfig, setConfig } from '../services/config-store.js'

/**
 * Разные мелкие функции уровня OS, не вписывающиеся в специализированные
 * сервисы.
 *
 *  - app:openFolder       — открыть путь в системном файловом менеджере
 *  - app:deleteProjectLocal — удалить локальный clone проекта + почистить
 *                              per-project overrides из config'а
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

  /**
   * Удаляет локальный clone проекта и зачищает связанный per-slug-state:
   *   - rm -rf projectsRoot/<slug>
   *   - delete runOverrides[slug]
   *   - delete databaseOverrides[slug]
   *
   * НЕ дропает БД самого проекта — это отдельная операция (Drop database
   * в DB-секции). Не удаляет проект из VCS-источника — после удаления
   * локально, проект всё равно остаётся в списке (cloned=false), его
   * можно склонировать заново.
   *
   * Если процесс проекта запущен — отказывает: на Windows активные
   * хэндлы файлов блокируют rm. Юзер должен сначала Stop.
   */
  ipcMain.handle('app:deleteProjectLocal', async (_event, slug) => {
    if (!slug || typeof slug !== 'string') {
      throw new Error('Slug is required')
    }
    if (processManager.isRunning(slug)) {
      throw new Error(
        `${slug} is running. Stop the process first, then delete.`
      )
    }
    const config = getConfig()
    const root = config.paths?.projectsRoot
    if (!root) {
      throw new Error('Projects folder not configured. Open Settings → Paths.')
    }
    if (projectExists(root, slug)) {
      const target = projectPath(root, slug)
      try {
        await rm(target, { recursive: true, force: true })
      } catch (e) {
        throw new Error(
          `Failed to delete ${target}: ${e?.message || e}`
        )
      }
    }

    // Зачищаем per-slug overrides — иначе после re-setup проект приходит
    // с stale-настройками которые могут уже не подходить (cwd указывает
    // в несуществующую папку, dbName заточен под прежнюю структуру).
    const runOverrides = { ...(config.runOverrides || {}) }
    const databaseOverrides = { ...(config.databaseOverrides || {}) }
    let mutated = false
    if (Object.prototype.hasOwnProperty.call(runOverrides, slug)) {
      delete runOverrides[slug]
      mutated = true
    }
    if (Object.prototype.hasOwnProperty.call(databaseOverrides, slug)) {
      delete databaseOverrides[slug]
      mutated = true
    }
    if (mutated) {
      setConfig({ runOverrides, databaseOverrides })
    }
    return { ok: true }
  })
}
