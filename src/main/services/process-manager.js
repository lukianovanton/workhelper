/**
 * In-memory менеджер `dotnet run` процессов (раздел 9.3 спеки).
 *
 * Map<slug, ProcessHandle>:
 *   - child       — Node ChildProcess
 *   - pid         — child.pid
 *   - port        — детектится из stdout по regex "Now listening on:..."
 *   - startedAt   — ISO timestamp
 *   - logs        — RingBuffer на 1000 строк (для будущего Logs tab)
 *
 * Жизненный цикл: процесс живёт ровно одну сессию приложения.
 * При app.before-quit все children гасятся через tree-kill.
 *
 * Эмиссия событий в renderer — через инжектируемую функцию `emit`,
 * хранится модулем после первого setEmit (зовут из process.ipc.js).
 */

import { spawn } from 'node:child_process'
import path from 'node:path'
import treeKill from 'tree-kill'
import { getConfig } from './config-store.js'
import { projectExists, projectPath, resolveRunnableSubpath } from './fs-service.js'

const URL_REGEX = /Now listening on:\s*(https?:\/\/\S+)/i
const LOG_BUFFER_SIZE = 1000

class RingBuffer {
  constructor(max) {
    this.max = max
    this.lines = []
  }
  push(item) {
    this.lines.push(item)
    if (this.lines.length > this.max) this.lines.shift()
  }
  snapshot() {
    return [...this.lines]
  }
}

/** @type {Map<string, {child:any, pid:number, port:number|null, startedAt:string, logs:RingBuffer}>} */
const processes = new Map()

/** @type {(event: string, payload: any) => void} */
let emit = () => {}

export function setEmitter(fn) {
  emit = typeof fn === 'function' ? fn : () => {}
}

/**
 * @param {string} slug
 * @returns {Promise<{pid: number, cwd: string}>}
 */
export async function run(slug) {
  if (processes.has(slug)) {
    const p = processes.get(slug)
    throw new Error(
      `${slug} is already running on :${p.port ?? '?'} (PID ${p.pid}). Stop it first.`
    )
  }

  const config = getConfig()
  const root = config.paths.projectsRoot
  if (!root) {
    throw new Error('Projects folder not configured. Open Settings → Paths.')
  }
  if (!projectExists(root, slug)) {
    throw new Error(
      `${slug} is not cloned at ${projectPath(root, slug)}.`
    )
  }

  const repoPath = projectPath(root, slug)
  const overrides = config.dotnet.workingDirSubpathOverride || {}
  const subpath = await resolveRunnableSubpath(
    repoPath,
    slug.toLowerCase(),
    overrides
  )
  if (!subpath) {
    throw new Error(
      `Cannot detect runnable project for ${slug}. Set workingDirSubpath override in Settings → .NET.`
    )
  }
  const cwd = path.join(repoPath, subpath)

  const args = ['run', ...(config.dotnet.runArgs || [])]
  const child = spawn('dotnet', args, {
    cwd,
    shell: false,
    detached: false,
    windowsHide: true,
    env: { ...process.env, DOTNET_NOLOGO: '1' }
  })

  // Дождаться 'spawn' либо 'error' прежде, чем регистрировать handle —
  // ENOENT (нет dotnet в PATH) поднимется как rejection mutation.
  await new Promise((resolve, reject) => {
    const onSpawn = () => {
      child.removeListener('error', onError)
      resolve()
    }
    const onError = (err) => {
      child.removeListener('spawn', onSpawn)
      if (err && err.code === 'ENOENT') {
        reject(
          new Error(
            'dotnet executable not found in PATH. Install .NET SDK or check PATH.'
          )
        )
      } else {
        reject(new Error(`Failed to start dotnet: ${err.message}`))
      }
    }
    child.once('spawn', onSpawn)
    child.once('error', onError)
  })

  /** @type {ReturnType<typeof createHandle>} */
  const handle = createHandle(child)
  processes.set(slug, handle)

  const onChunk = (stream) => (data) => {
    const text = data.toString()
    handle.logs.push({ stream, text, ts: Date.now() })
    emit('log', { slug, chunk: text, stream })
    if (handle.url == null) {
      const m = text.match(URL_REGEX)
      if (m) {
        try {
          const u = new URL(m[1])
          handle.url = u.origin
          handle.port = Number(u.port) || null
          emit('port', {
            slug,
            port: handle.port,
            url: handle.url
          })
        } catch {
          // мусорный URL — игнорим, попробуем на след. чанке
        }
      }
    }
  }
  child.stdout?.on('data', onChunk('stdout'))
  child.stderr?.on('data', onChunk('stderr'))

  child.on('exit', (code, signal) => {
    processes.delete(slug)
    emit('exit', { slug, code, signal: signal || null })
  })

  return { pid: child.pid, cwd }
}

function createHandle(child) {
  return {
    child,
    pid: child.pid,
    port: null,
    url: null,
    startedAt: new Date().toISOString(),
    logs: new RingBuffer(LOG_BUFFER_SIZE)
  }
}

/**
 * Останавливает процесс и всю его дочернюю цепочку (`dotnet run`
 * нередко спавнит подпроцессы).
 *
 * @param {string} slug
 * @returns {Promise<void>}
 */
export function stop(slug) {
  const handle = processes.get(slug)
  if (!handle) {
    throw new Error(`${slug} is not running`)
  }
  return new Promise((resolve, reject) => {
    treeKill(handle.pid, 'SIGTERM', (err) => {
      if (err) reject(err)
      else resolve()
    })
  })
}

/**
 * @param {string} slug
 * @returns {boolean}
 */
export function isRunning(slug) {
  return processes.has(slug)
}

/**
 * Снимок всех живых процессов для UI-поллинга.
 *
 * @returns {{slug:string, pid:number, port:number|null, url:string|null, startedAt:string}[]}
 */
export function list() {
  return Array.from(processes.entries()).map(([slug, h]) => ({
    slug,
    pid: h.pid,
    port: h.port,
    url: h.url,
    startedAt: h.startedAt
  }))
}

/**
 * Лог-снимок (для будущего Logs tab).
 * @param {string} slug
 * @returns {{stream:string, text:string, ts:number}[]|null}
 */
export function logs(slug) {
  const handle = processes.get(slug)
  return handle ? handle.logs.snapshot() : null
}

/**
 * Гасит все процессы — вызывать на app.before-quit.
 * Синхронная (best-effort) — Electron не ждёт асинхронные операции
 * на before-quit без e.preventDefault().
 */
export function killAll() {
  for (const [, h] of processes) {
    try {
      treeKill(h.pid, 'SIGTERM')
    } catch {
      // ignore
    }
  }
  processes.clear()
}
