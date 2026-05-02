import { ipcMain } from 'electron'
import {
  detectRequiredNodeVersion,
  getSystemNodeVersion,
  getVoltaInfo,
  installVolta,
  installNodeViaVolta,
  nodeVersionSatisfies
} from '../services/node-version.js'
import { getConfig } from '../services/config-store.js'
import {
  projectExists,
  projectPath
} from '../services/fs-service.js'

/**
 * IPC для Node-version management через Volta.
 *
 *   - node:status(slug)       — single-shot снимок: requiredVersion +
 *                               systemVersion + Volta-инфо + флаг,
 *                               удовлетворяет ли система требуемой
 *   - node:installVolta()     — однокликовая установка Volta
 *   - node:installVersion(v)  — `volta install node@<v>`
 *
 * Status вычисляется per-slug, но если slug не клонирован или не
 * Node-проект — required=null, остальное всё равно отдаётся (UI
 * может показать «Volta installed; X system Node versions» для
 * Settings-экрана).
 */
export function registerNodeIpc() {
  ipcMain.handle('node:status', async (_event, slug) => {
    let required = null
    try {
      const root = getConfig().paths?.projectsRoot
      if (root && slug && projectExists(root, slug)) {
        required = detectRequiredNodeVersion(projectPath(root, slug))
      }
    } catch {
      // ignore — required=null, UI покажет «no required version detected»
    }
    const [systemVersion, volta] = await Promise.all([
      getSystemNodeVersion(),
      getVoltaInfo()
    ])
    const satisfied = required
      ? nodeVersionSatisfies(systemVersion, required.version) ||
        volta.nodeVersions.some((v) => nodeVersionSatisfies(v, required.version))
      : true
    return {
      required,
      systemVersion,
      volta,
      satisfied
    }
  })

  ipcMain.handle('node:installVolta', async () => {
    return installVolta()
  })

  ipcMain.handle('node:installVersion', async (_event, versionSpec) => {
    return installNodeViaVolta(versionSpec)
  })
}
