import { ipcMain } from 'electron'
import { openInVSCode } from '../services/editor-service.js'
import { projectPath } from '../services/fs-service.js'
import { getConfig } from '../services/config-store.js'

/**
 * editor:openInVSCode — главное действие MVP-1 на cloned проекте.
 * Сами вычисляем путь из projectsRoot + slug.toLowerCase(),
 * чтобы не доверять renderer-данным (могли устареть с момента enrich).
 */
export function registerEditorIpc() {
  ipcMain.handle('editor:openInVSCode', async (_event, slug) => {
    const root = getConfig().paths.projectsRoot
    if (!root) {
      throw new Error(
        'Projects folder not configured. Open Settings → Paths.'
      )
    }
    return openInVSCode(slug, projectPath(root, slug))
  })
}
