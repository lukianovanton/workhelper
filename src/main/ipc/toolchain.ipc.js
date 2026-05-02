import { ipcMain } from 'electron'
import {
  detectProjectRequirements,
  getToolchainState,
  getMissingTools,
  invalidateToolchainCache
} from '../services/toolchain/manager.js'
import {
  installBuildTools
} from '../services/toolchain/build-tools.js'
import {
  installPython
} from '../services/toolchain/python.js'
import { getConfig } from '../services/config-store.js'
import {
  projectExists,
  projectPath
} from '../services/fs-service.js'

/**
 * IPC для toolchain auto-install:
 *   - toolchain:status(slug)            — full state + per-project gap
 *   - toolchain:installBuildTools()     — VS Build Tools (UAC required)
 *   - toolchain:installPython()         — Python 3 per-user
 *   - toolchain:invalidateCache()       — после установок чтобы UI
 *                                          увидел свежий state
 */
export function registerToolchainIpc() {
  ipcMain.handle('toolchain:status', async (_event, slug) => {
    let requirements = null
    if (slug) {
      try {
        const root = getConfig().paths?.projectsRoot
        if (root && projectExists(root, slug)) {
          requirements = detectProjectRequirements(projectPath(root, slug))
        }
      } catch {
        // ignore — requirements останется null
      }
    }
    const state = await getToolchainState()
    const missing = requirements
      ? getMissingTools(requirements, state)
      : { buildTools: false, python: false, reasons: [], ok: true }
    return { requirements, state, missing }
  })

  ipcMain.handle('toolchain:installBuildTools', async () => {
    const result = await installBuildTools()
    invalidateToolchainCache()
    return result
  })

  ipcMain.handle('toolchain:installPython', async () => {
    const result = await installPython()
    invalidateToolchainCache()
    return result
  })

  ipcMain.handle('toolchain:invalidateCache', () => {
    invalidateToolchainCache()
    return { ok: true }
  })
}
