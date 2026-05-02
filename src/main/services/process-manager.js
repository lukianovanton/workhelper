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
  resolveRunnableSubpath,
  detectStack
} from './fs-service.js'

/**
 * Per-stack hooks: cwd-fallback и доп-environment. Раньше dotnet-логика
 * (resolveRunnableSubpath + DOTNET_NOLOGO=1) выполнялась для каждого
 * проекта, что и неправильно семантически (Node-проект не нуждается в
 * .sln-эвристике), и шумит в env незвёзвщими переменными.
 *
 * Контракт хука:
 *   resolveCwd(repoPath, slug) → string|null   путь относительно repo
 *                                               (или null если
 *                                               авто-cwd не нужен)
 *   env: Record<string,string>                 дополнительные env-vars
 *
 * Stack без хука = run из repo root, env только process.env.
 */
const STACK_HOOKS = {
  dotnet: {
    resolveCwd: async (repoPath, slug) =>
      resolveRunnableSubpath(repoPath, slug.toLowerCase(), {}),
    env: { DOTNET_NOLOGO: '1' }
  }
}

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
 *   2. Auto-detect через STACK_HOOKS[stackKind].resolveCwd (.NET-логика
 *      раньше единственная и применялась ко всем стекам — теперь
 *      gated за stackKind=='dotnet').
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

async function resolveCwd(slug, repoPath, override, stackKind) {
  const overrideCwd = resolveOverrideCwd(repoPath, override?.cwd)
  if (overrideCwd) return overrideCwd

  const hook = STACK_HOOKS[stackKind]
  if (hook?.resolveCwd) {
    const subpath = await hook.resolveCwd(repoPath, slug)
    if (subpath) return path.join(repoPath, subpath)
  }
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
  const [bin] = tokens

  // Стек определяем один раз: и cwd-fallback, и доп-env читают его
  // через STACK_HOOKS. Best-effort — если detect упал, считаем что
  // stack unknown (хук не сработает, что эквивалентно прежнему
  // поведению non-.NET проекта).
  let stackKind = null
  try {
    const detected = await detectStack(repoPath)
    stackKind = detected?.stackKind || null
  } catch {
    // ignore
  }

  const cwd = await resolveCwd(slug, repoPath, override, stackKind)
  // Проверяем cwd ДО spawn'а: иначе spawn упадёт с ENOENT, который
  // неотличим от «binary not found», и пользователь увидит вводящее
  // в заблуждение сообщение про dotnet хотя проблема в неверном
  // override.cwd.
  if (!fs.existsSync(cwd)) {
    throw new Error(
      `Working directory not found: ${cwd}. Check the per-project cwd override in the drawer.`
    )
  }

  // На Windows многие реальные dev-команды (`npm`, `yarn`, `pnpm`, `npx`,
  // `vite`, `next`, etc.) — это `.cmd`/`.bat`-шимы. Node со starting from
  // 16+ не запускает их напрямую через spawn без shell:true (CVE-2024-27980).
  // Поэтому на Windows пускаем через cmd.exe целым cmdline'ом — он сам
  // разрезолвит шим через PATHEXT и обработает quoting как пользователь
  // ожидает. На POSIX оставляем direct exec — там npm и компания обычно
  // нативные исполняемые с shebang и shell:true только мешает
  // (промежуточный sh-процесс между нами и реальной программой,
  // tree-kill сложнее). Если detected `bin` уже выглядит как абсолютный
  // .exe-путь — тоже не нужен shell.
  const isWin = process.platform === 'win32'
  const useShell =
    isWin && !/^[a-z]:[\\/].+\.exe$/i.test(bin)

  const spawnArgs = useShell
    ? [cmdline, [], { cwd, shell: true, detached: false, windowsHide: true }]
    : [bin, tokens.slice(1), { cwd, shell: false, detached: false, windowsHide: true }]

  // Per-stack env: только то, что нужно конкретному стеку. Раньше
  // DOTNET_NOLOGO ставился на каждый spawn независимо от стека —
  // безвредно, но шумно в env у Node/Rust/Go.
  spawnArgs[2].env = {
    ...process.env,
    ...(STACK_HOOKS[stackKind]?.env || {})
  }

  const child = spawn(...spawnArgs)

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
    // Когда процесс умирает, не успев забиндить порт — это почти всегда
    // ошибка пользователя (`npm install` не пробежал, нет start-скрипта,
    // упало с module-not-found, etc.) Отдаём в renderer достаточно
    // диагностики чтобы показать toast: код выхода, был ли это
    // «ранний» exit (без порта), и tail последних логов.
    // userStopped — если юзер сам нажал Stop, не алармируем: на Windows
    // tree-kill даёт code=1, signal=null (taskkill /F), что иначе
    // выглядит как fail.
    const exitedEarly = handle.port == null
    const tail = handle.logs.snapshot().slice(-25)
    const tailText = tail
      .map((l) => l.text)
      .join('')
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(-12)
      .join('\n')
    emit('exit', {
      slug,
      code,
      signal: signal || null,
      exitedEarly,
      userStopped: !!handle.userStopped,
      tail: tailText
    })
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
  // Помечаем handle до tree-kill: child.on('exit') может выстрелить
  // прежде чем callback tree-kill'а вернётся — тогда exit-event прилетит
  // в renderer без флага userStopped и юзер увидит ложный toast.
  handle.userStopped = true
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
    h.userStopped = true
    try {
      treeKill(h.pid, 'SIGTERM')
    } catch {
      // ignore
    }
  }
  processes.clear()
}
