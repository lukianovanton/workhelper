/**
 * Обогащение списка проектов локальными статусами:
 *   - local.path / local.cloned     — fs.existsSync
 *   - local.runnableSubpath         — резолв через .sln + Program.cs
 *   - db.name / db.exists / db.size — мульти-engine, per-project routing
 *   - db.dumpPath                   — fs lookup
 *
 * Принцип: фейл одного источника НЕ ломает остальные. Если конкретный
 * engine недоступен — db.exists для проектов на нём остаётся false;
 * если projectsRoot пустой — local.cloned false для всех.
 *
 * Multi-engine: проекты группируются по своему engine (default или
 * override через config.databaseOverrides[slug].databaseId), для
 * каждой группы делается ОДИН listDatabases + ОДИН getDatabaseSizes
 * для имён, которые реально есть. Имя БД = slug.toLowerCase() либо
 * override.name.
 */

import * as fsService from './fs-service.js'
import { getEngine, getDefaultEngine } from './db/registry.js'
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
  // Per-project cwd-override используется только для UI-индикации
  // runnable subpath (показывается в drawer'е). Реальный cwd для
  // process-manager собирается отдельно при run().
  const runOverrides = config.runOverrides || {}
  const cwdOverrides = {}
  for (const [slug, ov] of Object.entries(runOverrides)) {
    if (ov?.cwd) cwdOverrides[slug] = ov.cwd
  }

  const dbOverrides = config.databaseOverrides || {}
  const warnings = []

  // ---- DB enrich, multi-engine -------------------------------------
  // Резолвим (engineId, dbName) для каждого проекта; группируем по
  // engineId; для каждого engine один listDatabases + один
  // getDatabaseSizes на имена, которые в нём реально есть.
  const defaultEngine = getDefaultEngine()
  const defaultEngineId = defaultEngine ? '__default__' : null

  /**
   * @typedef {{ engineId: string, engine: import('./db/types.js').DbEngine, dbName: string }} ResolvedProjectDb
   */

  /** @type {Map<string, ResolvedProjectDb>} */
  const resolvedBySlug = new Map()
  /** @type {Map<string, ResolvedProjectDb[]>} */
  const projectsByEngine = new Map()

  for (const p of projects) {
    const ov = dbOverrides[p.slug] || {}
    const dbName = (ov.name && ov.name.trim()) || p.slug.toLowerCase()
    let engine = null
    let engineKey = null
    if (ov.databaseId) {
      engine = getEngine(ov.databaseId)
      if (engine) engineKey = ov.databaseId
    }
    if (!engine && defaultEngine) {
      engine = defaultEngine
      engineKey = defaultEngineId
    }
    if (!engine) {
      // Нет ни override'а, ни default — db остаётся в нулевом состоянии.
      continue
    }
    const resolved = { engineId: engineKey, engine, dbName }
    resolvedBySlug.set(p.slug, resolved)
    if (!projectsByEngine.has(engineKey)) {
      projectsByEngine.set(engineKey, [])
    }
    projectsByEngine.get(engineKey).push(resolved)
  }

  /** Map<slug, { exists: boolean, sizeBytes: number|null }> */
  const dbInfoBySlug = new Map()
  for (const [engineKey, items] of projectsByEngine.entries()) {
    if (items.length === 0) continue
    const engine = items[0].engine
    let allNames = new Set()
    try {
      allNames = await engine.listDatabases()
    } catch (e) {
      warnings.push(
        `Database enrich skipped for engine ${engineKey === defaultEngineId ? engine.type : engineKey}: ${e.message}`
      )
      continue
    }
    const probedNames = items
      .map((i) => i.dbName)
      .filter((n) => allNames.has(n))
    let sizes = new Map()
    if (probedNames.length > 0) {
      try {
        sizes = await engine.getDatabaseSizes(probedNames)
      } catch {
        // ignore — size фолбэкнется на null
      }
    }
    for (const item of items) {
      // Найти, какой проект соответствует этому resolved-объекту: ищем
      // по dbName и engineKey (slug сам в `resolved` не лежит).
      // Проще: пройдёмся по resolvedBySlug.
    }
    // Проще: bulk-обход — ниже соберём по slug'у напрямую.
    for (const [slug, resolved] of resolvedBySlug.entries()) {
      if (resolved.engineId !== engineKey) continue
      dbInfoBySlug.set(slug, {
        exists: allNames.has(resolved.dbName),
        sizeBytes: sizes.get(resolved.dbName) ?? null
      })
    }
  }

  // ---- Per-project FS — параллельно --------------------------------
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
        ? await fsService.resolveRunnableSubpath(
            localPath,
            slugLower,
            cwdOverrides
          )
        : null

      const dump = await fsService.findDump(dumpsRoot, p.slug)

      const resolved = resolvedBySlug.get(p.slug)
      const info = dbInfoBySlug.get(p.slug) || {
        exists: false,
        sizeBytes: null
      }

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
          name: resolved ? resolved.dbName : slugLower,
          exists: info.exists,
          sizeBytes: info.sizeBytes,
          dumpPath: dump?.path ?? null,
          dumpFilename: dump?.filename ?? null,
          dumpMtime: dump?.mtime ?? null
        }
      }
    })
  )

  return { projects: enriched, warnings }
}
