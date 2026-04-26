/**
 * Открытие проекта в VS Code (раздел 9.5 спеки).
 *
 * Логика:
 *   1. files = glob '*.code-workspace' в корне репо
 *   2. files.length > 0 → spawn(code, [files[0]])
 *   3. иначе              → spawn(code, [repoRoot])
 *
 * Когда в репо появятся workspace-файлы, поведение само переключится.
 *
 * Спавним detached + unref(), чтобы закрытие нашего Electron не
 * убивало запущенный VS Code.
 *
 * Резолвим абс. путь к бинарю через path-detect (избегаем
 * shell:true и DEP0190).
 */

import { spawn } from 'node:child_process'
import path from 'node:path'
import fsp from 'node:fs/promises'
import fs from 'node:fs'
import { getConfig } from './config-store.js'
import { whichBinary } from './path-detect.js'

/**
 * @param {string} slug
 * @param {string|null} projectPath  абс. путь к корню репо;
 *                                   приходит из enrich.local.path
 */
export async function openInVSCode(slug, projectPath) {
  if (!projectPath) {
    throw new Error(
      `Project ${slug} is not cloned locally — nothing to open.`
    )
  }
  if (!fs.existsSync(projectPath)) {
    throw new Error(
      `Project path does not exist on disk: ${projectPath}`
    )
  }

  const exec = getConfig().paths.vscodeExecutable || 'code'
  const abs = await whichBinary(exec)
  if (!abs) {
    throw new Error(
      `VS Code executable "${exec}" not found in PATH. Set absolute path in Settings → Paths.`
    )
  }

  // Glob *.code-workspace в корне репо
  let target = projectPath
  try {
    const entries = await fsp.readdir(projectPath)
    const workspaceFile = entries.find((f) =>
      f.toLowerCase().endsWith('.code-workspace')
    )
    if (workspaceFile) {
      target = path.join(projectPath, workspaceFile)
    }
  } catch {
    // если readdir упал, всё равно попробуем открыть саму папку
  }

  // Гонка spawn-vs-error: если 'error' прилетит первым (ENOENT,
  // EACCES и т.п.) — пробрасываем в renderer, не глотаем. На 'spawn'
  // unref'аем и репортим успех. Раньше child.on('error') писал в
  // console.error main-процесса, который в packaged-сборке никто
  // не видит — пользователь думал, что Open молча не работает.
  return await new Promise((resolve, reject) => {
    const child = spawn(abs, [target], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    })

    let settled = false
    child.once('spawn', () => {
      if (settled) return
      settled = true
      child.unref()
      resolve({ opened: target })
    })
    child.once('error', (err) => {
      if (settled) return
      settled = true
      reject(
        new Error(
          `Failed to launch VS Code (${abs}): ${err?.message || err}`
        )
      )
    })
  })
}
