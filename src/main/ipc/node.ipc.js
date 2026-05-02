import { ipcMain } from 'electron'
import {
  detectRequiredNodeVersion,
  getSystemNodeVersion,
  getVoltaInfo,
  installVolta,
  installNodeViaVolta,
  nodeVersionSatisfies,
  writeNvmrcForProject,
  isNodeProject
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
    let nodeProject = false
    let repoPath = null
    try {
      const root = getConfig().paths?.projectsRoot
      if (root && slug && projectExists(root, slug)) {
        repoPath = projectPath(root, slug)
        required = detectRequiredNodeVersion(repoPath)
        nodeProject = isNodeProject(repoPath)
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
      satisfied,
      isNodeProject: nodeProject
    }
  })

  /**
   * Записывает .nvmrc в проект + одновременно ставит версию через
   * Volta (если установлен). Возвращает аггрегированный статус.
   * UI вызывает один раз когда юзер выбрал версию в picker'е.
   */
  ipcMain.handle('node:writeNvmrc', async (_event, slug, version) => {
    if (!slug || !version) {
      return { ok: false, message: 'slug and version are required' }
    }
    const root = getConfig().paths?.projectsRoot
    if (!root || !projectExists(root, slug)) {
      return {
        ok: false,
        message: `${slug} is not cloned. Clone the project first.`
      }
    }
    const repoPath = projectPath(root, slug)
    const writeResult = writeNvmrcForProject(repoPath, version)
    if (!writeResult.ok) {
      return writeResult
    }
    // Volta install — best-effort. Если Volta не установлен, юзер
    // увидит warning, но .nvmrc уже записан.
    const volta = await getVoltaInfo()
    if (!volta.installed) {
      return {
        ok: true,
        message: `Wrote .nvmrc with Node ${version}. Install Volta to auto-switch to this version.`
      }
    }
    const installResult = await installNodeViaVolta(version)
    return {
      ok: installResult.ok,
      message: installResult.ok
        ? `Wrote .nvmrc and installed Node ${version} via Volta.`
        : `Wrote .nvmrc but Volta install failed: ${installResult.message}`
    }
  })

  ipcMain.handle('node:installVolta', async () => {
    return installVolta()
  })

  ipcMain.handle('node:installVersion', async (_event, versionSpec) => {
    return installNodeViaVolta(versionSpec)
  })
}
