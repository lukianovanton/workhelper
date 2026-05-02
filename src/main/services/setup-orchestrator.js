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
import {
  detectRequiredNodeVersion,
  getVoltaInfo,
  installNodeViaVolta,
  nodeVersionSatisfies,
  getSystemNodeVersion
} from './node-version.js'
import {
  detectProjectRequirements,
  getToolchainState,
  getMissingTools
} from './toolchain/manager.js'

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

    // ─── c.3) toolchain-prep — детектим missing build tools ────────
    // Только сообщает (не ставит): UI-banner в Setup-dialog'е выдаёт
    // юзеру кнопки «Install Build Tools» / «Install Python» с чёткими
    // ожиданиями (UAC, размер). Если юзер пропустил — npm install
    // упадёт с своей родной ошибкой; мы потом её распарсим (Phase 3).
    checkCancel()
    if (config.paths.projectsRoot) {
      try {
        await runToolchainPrepStep(
          fsService.projectPath(config.paths.projectsRoot, slug),
          beginStep,
          endStep,
          errorStep,
          emitStep
        )
      } catch (e) {
        // best-effort — не валим setup на toolchain-detect
        console.warn(
          '[setup] toolchain-prep failed:',
          e?.message || e
        )
      }
    } else {
      emitStep({
        kind: 'toolchain-prep',
        status: 'done',
        message: 'Skipped'
      })
    }

    // ─── c.4) node-prep — Volta + правильная Node-версия ─────────────
    // Если у проекта закреплена Node-версия (package.json#engines /
    // .nvmrc / volta.node) и она отличается от системной, пытаемся
    // подтянуть нужную через Volta. Если Volta установлен — install
    // идемпотентно и pin не пишем (Volta auto-switch'ит по project-
    // файлам через PATH-shim). Если Volta нет — done с предупреждением,
    // дальнейший npm install пойдёт с системного node (может упасть
    // на gyp/native deps если major'ы расходятся, но это лучше чем
    // блокировать установку без Volta).
    checkCancel()
    if (config.paths.projectsRoot) {
      try {
        await runNodePrepStep(
          fsService.projectPath(config.paths.projectsRoot, slug),
          beginStep,
          endStep,
          errorStep,
          emitStep
        )
      } catch (e) {
        // Не фатально для setup'а — пропускаем дальше с warning'ом.
        // Volta может фейлить из-за network'а, миссинг winget и т.п.
        // npm install попробует на системном node.
        console.warn('[setup] node-prep failed:', e?.message || e)
      }
    } else {
      emitStep({ kind: 'node-prep', status: 'done', message: 'Skipped' })
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

async function runToolchainPrepStep(
  repoPath,
  beginStep,
  endStep,
  errorStep,
  emitStep
) {
  const requirements = detectProjectRequirements(repoPath)
  if (
    !requirements.isNodeProject ||
    requirements.node.nativeDeps.length === 0
  ) {
    emitStep({
      kind: 'toolchain-prep',
      status: 'done',
      message: 'No native build tools required'
    })
    return
  }
  const state = await getToolchainState({ forceRefresh: true })
  const missing = getMissingTools(requirements, state)
  if (missing.ok) {
    emitStep({
      kind: 'toolchain-prep',
      status: 'done',
      message: 'Build toolchain ready'
    })
    return
  }
  // Что-то отсутствует — НЕ автозапускаем install (Build Tools требует
  // UAC, юзер должен решить сам). Просто эмитим warning-step с
  // подробностями. Юзер увидит баннер в Setup dialog и кнопки;
  // npm install попробует на том что есть, потом мы парсим ошибку.
  const list = []
  if (missing.buildTools) list.push('VS Build Tools')
  if (missing.python) list.push('Python')
  emitStep({
    kind: 'toolchain-prep',
    status: 'done',
    message: `Missing: ${list.join(' + ')}. Install via banner above before retrying if npm install fails on native deps.`
  })
}

async function runNodePrepStep(
  repoPath,
  beginStep,
  endStep,
  errorStep,
  emitStep
) {
  // Не Node-проект → no-op done
  const required = detectRequiredNodeVersion(repoPath)
  if (!required) {
    emitStep({
      kind: 'node-prep',
      status: 'done',
      message: 'No Node version pinned'
    })
    return
  }

  // Сравним с системным
  const sys = await getSystemNodeVersion()
  if (sys && nodeVersionSatisfies(sys, required.version)) {
    emitStep({
      kind: 'node-prep',
      status: 'done',
      message: `System Node ${sys} satisfies required ${required.raw}`
    })
    return
  }

  // Нужна другая версия. Если Volta установлен — попробуем install.
  const volta = await getVoltaInfo()
  if (!volta.installed) {
    emitStep({
      kind: 'node-prep',
      status: 'done',
      message: `Project requires Node ${required.raw} (system: ${sys || 'not found'}). Volta not installed — install Volta from Settings to auto-manage versions.`
    })
    return
  }

  // Volta уже знает эту версию?
  const alreadyHave = volta.nodeVersions.some((v) =>
    nodeVersionSatisfies(v, required.version)
  )
  if (alreadyHave) {
    emitStep({
      kind: 'node-prep',
      status: 'done',
      message: `Volta already has Node ${required.raw}`
    })
    return
  }

  // Тащим версию через Volta. Может занять минуту (download + install).
  const t = beginStep('node-prep')
  const result = await installNodeViaVolta(required.version)
  if (result.ok) {
    endStep(
      'node-prep',
      t,
      `Installed Node ${required.raw} via Volta`
    )
  } else {
    // Не валим setup — просто warning в шаге. npm install попробует
    // на системном node (может упасть на native-deps).
    errorStep('node-prep', result.message)
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
    const fullErr =
      (result.stderrTail || '') + '\n' + (result.stdoutTail || '')
    const detail = fullErr
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(-3)
      .join(' | ')
      .slice(0, 240)
    const hint = analyzeNpmInstallError(fullErr)
    const msg = `${pm.pmName} install exited with code ${result.code}${
      detail ? `: ${detail}` : ''
    }${hint ? ` — ${hint}` : ''}`
    errorStep('deps', msg)
    throw new Error(msg)
  }
  endStep('deps', t, `${pm.pmName} install ok`)
}

/**
 * Парсит типичные ошибки npm install / node-gyp и подсказывает что
 * чинить. Возвращает короткое actionable-сообщение либо null. Эти
 * хинты дополняют toolchain-banner в Setup dialog'е — если юзер
 * проигнорировал его и всё равно нажал Setup, в финальном error
 * step'е увидит конкретное предложение.
 */
function analyzeNpmInstallError(text) {
  if (!text || typeof text !== 'string') return null
  if (
    /gyp err!.*find python|python (was|is) (not|cannot)|no python found/i.test(
      text
    )
  ) {
    return 'Python is missing — open Setup again, click "Install Python" in the toolchain banner, then retry.'
  }
  if (
    /could not find any visual studio|msbuild.*not found|cannot find module 'node-gyp'|cl\.exe.*not.*recognized|c\+\+ compiler/i.test(
      text
    )
  ) {
    return 'Visual Studio Build Tools missing — open Setup again, click "Install Build Tools (UAC)" in the toolchain banner, then retry.'
  }
  if (/node-sass.*not compatible|abi.*mismatch|nan\s+\d+\.\d+/i.test(text)) {
    return 'Native module incompatible with current Node version — pin an older Node via the Node banner (e.g., Node 16) and retry.'
  }
  if (/eacces|permission denied/i.test(text)) {
    return 'Permission denied — check the project folder is writable and not held open by another process.'
  }
  if (/etarget|version not found/i.test(text)) {
    return 'A package version is no longer published. The project may need an upstream lockfile / engines update.'
  }
  return null
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
