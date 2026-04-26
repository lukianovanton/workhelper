/**
 * Обогащение списка проектов локальными статусами (раздел 9.1).
 *
 * Текущий чекпоинт (MVP-1 step 5/6) включает:
 *   - local.path / local.cloned    — fs.existsSync
 *   - local.runnableSubpath        — резолв через .sln + Program.cs (9.5)
 *   - db.name / db.exists / db.size — mysql2 одним коннектом
 *   - db.dumpPath                  — fs lookup (9.4)
 *
 * НЕ включает (отложено до MVP-1 step 8 / MVP-2):
 *   - local.dirty / local.branch   — simple-git (по нажатию или раз в N мин)
 *   - runtime.running              — process-manager
 *
 * Принцип: фейл одного источника НЕ ломает остальные. Если БД
 * недоступна — db.exists остаётся false для всех; если projectsRoot
 * пустой — local.cloned для всех false.
 */

import * as fsService from './fs-service.js'
import * as dbService from './db-service.js'
import { getConfig } from './config-store.js'

/**
 * @param {import('../../shared/types.js').Project[]} projects
 * @returns {Promise<{
 *   projects: import('../../shared/types.js').Project[],
 *   warnings: string[]
 * }>}
 */
export async function enrichProjects(projects) {
  const config = getConfig()
  const projectsRoot = config.paths.projectsRoot
  const dumpsRoot = config.paths.dumpsRoot
  const overrides = config.dotnet.workingDirSubpathOverride || {}
  const warnings = []

  // БД — одним заходом для всех
  let dbNames = new Set()
  let dbSizes = new Map()
  try {
    dbNames = await dbService.listDatabases()
    if (dbNames.size > 0) {
      const slugLowers = projects
        .map((p) => p.slug.toLowerCase())
        .filter((n) => dbNames.has(n))
      if (slugLowers.length > 0) {
        dbSizes = await dbService.getDatabaseSizes(slugLowers)
      }
    }
  } catch (e) {
    warnings.push(`Database enrich skipped: ${e.message}`)
  }

  // Per-project FS — параллельно
  const enriched = await Promise.all(
    projects.map(async (p) => {
      const slugLower = p.slug.toLowerCase()
      const localPath = projectsRoot
        ? fsService.projectPath(projectsRoot, p.slug)
        : null
      const cloned = projectsRoot
        ? fsService.projectExists(projectsRoot, p.slug)
        : false

      const runnableSubpath = cloned
        ? await fsService.resolveRunnableSubpath(localPath, slugLower, overrides)
        : null

      const dump = await fsService.findDump(dumpsRoot, p.slug)

      return {
        ...p,
        local: {
          ...p.local,
          path: localPath,
          cloned,
          runnableSubpath
        },
        db: {
          ...p.db,
          name: slugLower,
          exists: dbNames.has(slugLower),
          sizeBytes: dbSizes.get(slugLower) ?? null,
          dumpPath: dump?.path ?? null,
          dumpFilename: dump?.filename ?? null,
          dumpMtime: dump?.mtime ?? null
        }
      }
    })
  )

  return { projects: enriched, warnings }
}
