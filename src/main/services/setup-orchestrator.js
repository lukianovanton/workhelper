/**
 * Setup full — оркестрация ч7-9 building blocks (раздел 9.2 спеки).
 *
 * Шаги:
 *   a) clone        — git-service.clone (skip если уже cloned)
 *   b) db-create    — db-service.createDatabase (skip если БД есть)
 *   c) db-restore   — db-service.restoreDatabase (skip если нет дампа
 *                     или skipRestore=true)
 *   d) workspace    — editor-service.openInVSCode
 *   e) (silent) run — process-manager.run если runAfter=true.
 *                     НЕ эмитит SetupStep — это уже не setup.
 *
 * Каждый шаг падает → emit error → останов. Никаких rollback'ов:
 * cloned папка остаётся, созданная БД остаётся, частично restore'нутая
 * БД остаётся. Юзер сам решит, что делать.
 *
 * Cancel: setCancel(slug) ставит флаг + форсит kill активного restore
 * (clone и mysql cmds через kill — clone через simple-git нельзя прервать
 * детерминированно, поэтому он добежит до конца).
 */

import * as gitService from './git-service.js'
import * as fsService from './fs-service.js'
import * as editorService from './editor-service.js'
import * as processManager from './process-manager.js'
import { getConfig, setConfig } from './config-store.js'
import { resolveProjectDb } from './db/registry.js'
import { resolvePackageManager, runPmCommand } from './node-deps.js'

const activeSetups = new Map()

class CancelledError extends Error {
  constructor() {
    super('Setup cancelled by user')
    this.name = 'CancelledError'
    this.cancelled = true
  }
}

export function isSetupActive(slug) {
  return activeSetups.has(slug)
}

export function cancelSetup(slug) {
  const handle = activeSetups.get(slug)
  if (!handle) return false
  handle.cancelled = true
  // Ускоряем cancel в текущем шаге, который умеет сам прерываться.
  // Резолвим engine конкретного проекта (override → default).
  const { engine } = resolveProjectDb(slug)
  if (engine && engine.isRestoring(slug)) {
    engine.cancelRestore(slug)
  }
  return true
}

/**
 * @param {string} slug
 * @param {{dumpPath?:string|null, skipRestore?:boolean, skipDb?:boolean, runAfter?:boolean, openWorkspace?:boolean}} options
 * @param {(step: import('../../shared/types.js').SetupStep) => void} emitStep
 */
export async function runFull(slug, options, emitStep) {
  if (activeSetups.has(slug)) {
    throw new Error(`Setup already in progress for ${slug}`)
  }
  const handle = { cancelled: false, startedAt: Date.now() }
  activeSetups.set(slug, handle)

  const config = getConfig()
  // Per-project DB routing (Phase: databaseOverrides). Engine + точное
  // имя БД могут быть оверрайднуты, иначе — default engine + slug.toLowerCase().
  const { engine: dbEngine, dbName } = resolveProjectDb(slug)

  const checkCancel = () => {
    if (handle.cancelled) throw new CancelledError()
  }

  const beginStep = (kind) => {
    const t = Date.now()
    emitStep({ kind, status: 'start' })
    return t
  }
  const endStep = (kind, t, message) => {
    emitStep({
      kind,
      status: 'done',
      durationMs: Date.now() - t,
      message
    })
  }
  const errorStep = (kind, message) => {
    emitStep({ kind, status: 'error', message })
  }

  try {
    // skipDb-флаг — это намерение проекта, а не разовое решение для
    // одного запуска setup. Persist'им до старта шагов, чтобы UI на
    // деталях проекта мог сразу его прочитать (Database override
    // секция скрыта для проектов без БД).
    persistSkipDbIntent(slug, !!options?.skipDb)

    // ─── a) clone ────────────────────────────────────────────────────
    checkCancel()
    if (
      config.paths.projectsRoot &&
      fsService.projectExists(config.paths.projectsRoot, slug)
    ) {
      emitStep({
        kind: 'clone',
        status: 'done',
        message: 'Already cloned'
      })
    } else {
      const t = beginStep('clone')
      try {
        await gitService.clone(slug)
      } catch (e) {
        errorStep('clone', e?.message || String(e))
        throw e
      }
      endStep('clone', t)
    }

    // Auto-detect run override после клона. Setup-диалог детектит
    // стек только для информационной строки + setupDb-дефолта, но не
    // сохраняет результат — поэтому у только что клонированного
    // Node/Rust/Go-проекта `runOverrides[slug]` оставался пустым,
    // post-setup `Run` уходил в global default `dotnet run` и падал.
    // Persist'им один раз — только если override ещё не задан
    // пользователем (не клобберим ручную настройку).
    try {
      if (config.paths.projectsRoot) {
        await persistDetectedRunOverride(
          slug,
          fsService.projectPath(config.paths.projectsRoot, slug)
        )
      }
    } catch {
      // Detect — best-effort. Если упал — не валим setup; пользователь
      // выставит override руками в drawer'е.
    }

    // ─── b) db-create ────────────────────────────────────────────────
    // skipDb=true (например, фронтенд-проекту БД не нужна) пропускает
    // и db-create, и db-restore целиком. emit'им done со статусом
    // 'Skipped' чтобы UI отрисовал прогресс-чеклист в полном виде.
    checkCancel()
    if (options?.skipDb) {
      emitStep({
        kind: 'db-create',
        status: 'done',
        message: 'Skipped (no DB needed)'
      })
      emitStep({
        kind: 'db-restore',
        status: 'done',
        message: 'Skipped (no DB needed)'
      })
    } else {
      if (!dbEngine) {
        errorStep(
          'db-create',
          'No database engine configured. Open Settings → Databases.'
        )
        throw new Error('No database engine configured')
      }
      let dbExisted = false
      try {
        const dbs = await dbEngine.listDatabases()
        dbExisted = dbs.has(dbName)
      } catch (e) {
        errorStep(
          'db-create',
          `Cannot reach DB: ${e?.message || String(e)}`
        )
        throw e
      }

      if (dbExisted) {
        emitStep({
          kind: 'db-create',
          status: 'done',
          message: 'Already exists'
        })
      } else {
        const t = beginStep('db-create')
        try {
          await dbEngine.createDatabase(dbName)
        } catch (e) {
          errorStep('db-create', e?.message || String(e))
          throw e
        }
        endStep('db-create', t)
      }

      // ─── c) db-restore ─────────────────────────────────────────────
      checkCancel()
      let dumpPath = options?.dumpPath || null
      if (!dumpPath && !options?.skipRestore) {
        const dump = await fsService.findDump(config.paths.dumpsRoot, slug)
        if (dump) dumpPath = dump.path
      }

      if (options?.skipRestore) {
        emitStep({
          kind: 'db-restore',
          status: 'done',
          message: 'Skipped (user choice)'
        })
      } else if (!dumpPath) {
        emitStep({
          kind: 'db-restore',
          status: 'done',
          message: 'No dump available, skipped'
        })
      } else {
      const t = beginStep('db-restore')
      try {
        await dbEngine.restoreDatabase(
          dbName,
          dumpPath,
          slug,
          ({ bytesRead, totalBytes }) => {
            const percent =
              totalBytes > 0 ? (bytesRead / totalBytes) * 100 : 0
            emitStep({
              kind: 'db-restore',
              status: 'progress',
              percent,
              bytesRead,
              totalBytes
            })
          }
        )
      } catch (e) {
        // Если cancel прилетел во время restore, mysql упадёт с
        // SIGTERM — поднимем как Cancelled, не как обычный fail.
        if (handle.cancelled) throw new CancelledError()
        errorStep('db-restore', e?.message || String(e))
        throw e
      }
      endStep('db-restore', t)
      }
    }

    // ─── c.5) deps install ───────────────────────────────────────────
    // Свежеклонированные Node-проекты не запустятся без `npm install`:
    // `npm run start` упадёт с module-not-found как только spawn найдёт
    // package.json. Делаем install автоматически по lockfile (npm /
    // pnpm / yarn). Skip если node_modules уже есть (повторный setup).
    // Для не-Node стеков шаг отдаёт done «Skipped».
    checkCancel()
    if (config.paths.projectsRoot) {
      try {
        await runDepsStep(
          fsService.projectPath(config.paths.projectsRoot, slug),
          beginStep,
          endStep,
          errorStep,
          emitStep
        )
      } catch (e) {
        // deps-fail — фатально. Без зависимостей run всё равно упадёт,
        // лучше остановить setup явной ошибкой.
        throw e
      }
    } else {
      emitStep({ kind: 'deps', status: 'done', message: 'Skipped' })
    }

    // ─── d) workspace (optional, opt-in) ─────────────────────────────
    checkCancel()
    if (options?.openWorkspace) {
      const t = beginStep('workspace')
      try {
        const projectPath = fsService.projectPath(
          config.paths.projectsRoot,
          slug
        )
        await editorService.openInVSCode(slug, projectPath)
      } catch (e) {
        errorStep('workspace', e?.message || String(e))
        throw e
      }
      endStep('workspace', t)
    } else {
      emitStep({
        kind: 'workspace',
        status: 'done',
        message: 'Skipped (user choice)'
      })
    }

    // ─── e) run dotnet (silent, no SetupStep) ────────────────────────
    if (options?.runAfter) {
      try {
        await processManager.run(slug)
      } catch (e) {
        // Run-фейл не делает setup'у плохо — он уже всё настроил.
        // В UI юзер увидит ошибку run в drawer'е через runtime-поллинг.
        console.warn('[setup] post-setup run failed:', e?.message)
      }
    }
  } finally {
    activeSetups.delete(slug)
  }
}

async function runDepsStep(repoPath, beginStep, endStep, errorStep, emitStep) {
  const pm = resolvePackageManager(repoPath)
  if (!pm.hasPackageJson) {
    emitStep({
      kind: 'deps',
      status: 'done',
      message: 'Skipped (not a Node project)'
    })
    return
  }
  if (pm.hasNodeModules) {
    emitStep({
      kind: 'deps',
      status: 'done',
      message: `${pm.pmName}: node_modules already present`
    })
    return
  }

  const t = beginStep('deps')
  let result
  try {
    result = await runPmCommand(repoPath, pm.pmName, ['install'])
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      const msg = `'${pm.pmName}' not found in PATH. Install ${pm.pmName} or run install manually before retrying.`
      errorStep('deps', msg)
      throw new Error(msg)
    }
    const msg = `${pm.pmName} failed to start: ${err?.message || err}`
    errorStep('deps', msg)
    throw new Error(msg)
  }
  if (result.code !== 0) {
    const detail = (result.stderrTail.trim() || result.stdoutTail.trim() || '')
      .split(/\r?\n/)
      .slice(-3)
      .join(' | ')
      .slice(0, 240)
    const msg = `${pm.pmName} install exited with code ${result.code}${
      detail ? `: ${detail}` : ''
    }`
    errorStep('deps', msg)
    throw new Error(msg)
  }
  endStep('deps', t, `${pm.pmName} install ok`)
}

/**
 * Persist'ит skipDb-намерение для slug. true → ставим флаг (preserving
 * остальные поля overrideа — databaseId / name пользователь мог уже
 * выставить руками). false → снимаем флаг, остальное оставляем.
 */
function persistSkipDbIntent(slug, skipDb) {
  const config = getConfig()
  const all = { ...(config.databaseOverrides || {}) }
  const existing = { ...(all[slug] || {}) }
  if (skipDb) {
    existing.skipDb = true
  } else {
    delete existing.skipDb
  }
  // Если у override'а ничего полезного не осталось — удаляем запись
  // целиком, чтобы map не разрастался пустыми объектами.
  if (
    !existing.skipDb &&
    !existing.databaseId &&
    !(existing.name && existing.name.trim())
  ) {
    delete all[slug]
  } else {
    all[slug] = existing
  }
  setConfig({ databaseOverrides: all })
}

/**
 * Вызывает detectStack по локальному repoPath и записывает
 * runOverrides[slug] = { runCommand, cwd } если у проекта ещё нет
 * полезного override'а. Логика «полезный override»: либо runCommand
 * с непустым trim, либо cwd с непустым trim. Если есть хотя бы одно —
 * пользователь уже что-то настроил, не трогаем.
 */
async function persistDetectedRunOverride(slug, repoPath) {
  const config = getConfig()
  const existing = (config.runOverrides || {})[slug] || {}
  const hasUserCmd =
    typeof existing.runCommand === 'string' && existing.runCommand.trim() !== ''
  // Только наличие runCommand говорит о реальной user-action в Run-override
  // секции. cwd-only запись — почти всегда артефакт legacy-миграции
  // (`dotnet.workingDirSubpathOverride[slug] = 'src/api'` → migrate в
  // `runOverrides[slug] = { cwd: 'src/api' }` для всех проектов скопом).
  // Поэтому cwd-only отказывает detect'у в перезаписи, и проект на Node
  // упирался в `<root>/src/api` после re-setup. Считаем cwd-only за
  // «не настроено» — detect перетирает.
  if (hasUserCmd) return

  const detected = await fsService.detectStack(repoPath)
  if (!detected) return
  const runCommand = (detected.runCommand || '').trim()
  const cwd = (detected.cwd || '').trim()
  if (!runCommand && !cwd) return

  const all = { ...(config.runOverrides || {}) }
  all[slug] = { runCommand, cwd }
  setConfig({ runOverrides: all })
}

export { CancelledError }
