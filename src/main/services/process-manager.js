/**
 * In-memory менеджер запущенных процессов.
 *
 * Phase A.6: убран хардкод на `dotnet run`. Команда читается из
 * `config.runOverrides[slug].runCommand` или, если override нет,
 * из `config.defaults.runCommand` (default 'dotnet run'). cwd —
 * аналогично: `runOverrides[slug].cwd` (относительно project root)
 * либо auto-detect через resolveRunnableSubpath (legacy .NET-эвристика,
 * сохранена как fallback), либо сам корень проекта.
 *
 * Эмиссия событий в renderer — через инжектируемую функцию `emit`.
 */

import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import treeKill from 'tree-kill'
import { getConfig } from './config-store.js'
import {
  projectExists,
  projectPath,
  resolveRunnableSubpath
} from './fs-service.js'

// Расширенный URL_REGEX: ловит .NET (Now listening on:), Node/Express
// (listening on http...), Vite (Local: http...), общий «Server running at».
// Один и тот же паттерн на все стеки — пользователь вводит свою
// runCommand, а наш приёмник стандартных вариантов покроет 90% случаев.
const URL_REGEX =
  /(?:Now listening on|listening (?:on|at)|Local:|Server running at|Local server:)\s*[:\s]*(https?:\/\/\S+)/i
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

const processes = new Map()

let emit = () => {}

export function setEmitter(fn) {
  emit = typeof fn === 'function' ? fn : () => {}
}

/**
 * Простой парсер shell-like командной строки. Поддерживает
 * двойные одинарные кавычки для аргументов с пробелами; экранирование
 * не нужно (используем как-есть). Возвращает [bin, ...args].
 *
 * Примеры:
 *   'dotnet run'                       → ['dotnet', 'run']
 *   'npm run dev'                      → ['npm', 'run', 'dev']
 *   'go run .'                         → ['go', 'run', '.']
 *   'python -m http.server "8000"'     → ['python', '-m', 'http.server', '8000']
 *
 * @param {string} cmdline
 * @returns {string[]}
 */
function parseCommand(cmdline) {
  const tokens = []
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g
  let m
  while ((m = re.exec(cmdline)) !== null) {
    tokens.push(m[1] ?? m[2] ?? m[3])
  }
  return tokens
}

/**
 * Резолвит рабочую директорию для запуска. Приоритет:
 *   1. runOverrides[slug].cwd — явно задано пользователем. По UI-подсказке
 *      это путь относительно project root. Лидирующие `/` или `\` мы
 *      зачищаем (пользователи часто пишут «/affiliatecrm» имея в виду
 *      под-папку — на Windows path.isAbsolute бы съел такое как
 *      C:\affiliatecrm и spawn упал бы с ENOENT). Реальные абсолютные
 *      пути с drive-letter (Windows: «C:\…») / POSIX-абсолютные на
 *      *nix остаются абсолютными.
 *   2. Auto-detect через resolveRunnableSubpath (.NET-эвристика по
 *      .sln/Program.cs) — fallback для .NET-проектов без явного cwd.
 *   3. Сам project root.
 */
function resolveOverrideCwd(repoPath, raw) {
  const cwd = (raw || '').trim()
  if (!cwd) return null
  // Реально абсолютный путь — Windows drive-letter…
  if (process.platform === 'win32' && /^[a-z]:[\\/]/i.test(cwd)) {
    return cwd
  }
  // …или POSIX absolute на *nix.
  if (process.platform !== 'win32' && cwd.startsWith('/')) {
    return cwd
  }
  // Иначе считаем relative to project root, лидирующие slash/backslash
  // зачищаем — это пользовательская конвенция «папка от корня проекта».
  return path.join(repoPath, cwd.replace(/^[\\/]+/, ''))
}

async function resolveCwd(slug, repoPath, override) {
  const overrideCwd = resolveOverrideCwd(repoPath, override?.cwd)
  if (overrideCwd) return overrideCwd

  const subpath = await resolveRunnableSubpath(
    repoPath,
    slug.toLowerCase(),
    {}
  )
  if (subpath) return path.join(repoPath, subpath)
  return repoPath
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
  const override = (config.runOverrides || {})[slug]
  const cmdline =
    (override && override.runCommand && override.runCommand.trim()) ||
    (config.defaults?.runCommand || 'dotnet run')

  const tokens = parseCommand(cmdline)
  if (tokens.length === 0) {
    throw new Error(
      `Run command is empty for ${slug}. Set it in Settings → Defaults or per-project in the drawer.`
    )
  }
  const [bin, ...args] = tokens

  const cwd = await resolveCwd(slug, repoPath, override)
  // Проверяем cwd ДО spawn'а: иначе spawn упадёт с ENOENT, который
  // неотличим от «binary not found», и пользователь увидит вводящее
  // в заблуждение сообщение про dotnet хотя проблема в неверном
  // override.cwd.
  if (!fs.existsSync(cwd)) {
    throw new Error(
      `Working directory not found: ${cwd}. Check the per-project cwd override in the drawer.`
    )
  }

  const child = spawn(bin, args, {
    cwd,
    shell: false,
    detached: false,
    windowsHide: true,
    // DOTNET_NOLOGO для .NET-стека убирает баннер в stdout. Не вредит
    // другим стекам (для них переменная игнорируется), оставляем.
    env: { ...process.env, DOTNET_NOLOGO: '1' }
  })

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
            `'${bin}' executable not found in PATH. Check the run command in Settings → Defaults or per-project override.`
          )
        )
      } else {
        reject(new Error(`Failed to start ${bin}: ${err.message}`))
      }
    }
    child.once('spawn', onSpawn)
    child.once('error', onError)
  })

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

export function isRunning(slug) {
  return processes.has(slug)
}

export function list() {
  return Array.from(processes.entries()).map(([slug, h]) => ({
    slug,
    pid: h.pid,
    port: h.port,
    url: h.url,
    startedAt: h.startedAt
  }))
}

export function logs(slug) {
  const handle = processes.get(slug)
  return handle ? handle.logs.snapshot() : null
}

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
