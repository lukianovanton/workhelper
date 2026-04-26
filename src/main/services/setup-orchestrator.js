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
import * as dbService from './db-service.js'
import * as fsService from './fs-service.js'
import * as editorService from './editor-service.js'
import * as processManager from './process-manager.js'
import { getConfig } from './config-store.js'

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
  // Ускоряем cancel в текущем шаге, который умеет сам прерываться:
  if (dbService.isRestoring(slug)) {
    dbService.cancelRestore(slug)
  }
  return true
}

/**
 * @param {string} slug
 * @param {{dumpPath?:string|null, skipRestore?:boolean, runAfter?:boolean}} options
 * @param {(step: import('../../shared/types.js').SetupStep) => void} emitStep
 */
export async function runFull(slug, options, emitStep) {
  if (activeSetups.has(slug)) {
    throw new Error(`Setup already in progress for ${slug}`)
  }
  const handle = { cancelled: false, startedAt: Date.now() }
  activeSetups.set(slug, handle)

  const config = getConfig()
  const slugLower = slug.toLowerCase()

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

    // ─── b) db-create ────────────────────────────────────────────────
    checkCancel()
    let dbExisted = false
    try {
      const dbs = await dbService.listDatabases()
      dbExisted = dbs.has(slugLower)
    } catch (e) {
      errorStep(
        'db-create',
        `Cannot reach MySQL: ${e?.message || String(e)}`
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
        await dbService.createDatabase(slugLower)
      } catch (e) {
        errorStep('db-create', e?.message || String(e))
        throw e
      }
      endStep('db-create', t)
    }

    // ─── c) db-restore ───────────────────────────────────────────────
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
        await dbService.restoreDatabase(
          slugLower,
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

    // ─── d) workspace ────────────────────────────────────────────────
    checkCancel()
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

export { CancelledError }
