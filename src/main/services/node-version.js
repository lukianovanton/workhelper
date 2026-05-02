/**
 * Node version management через Volta.
 *
 * Volta — кросс-платформенный native version-manager для Node, npm,
 * yarn, pnpm. После установки автоматически перехватывает вызовы
 * `node` / `npm` и роутит к версии, закреплённой за проектом
 * (читает package.json#volta.node, package.json#engines.node, .nvmrc).
 * Это значит, что наш существующий runPmCommand'у НЕ требуется
 * никаких изменений — Volta всё разруливает прозрачно через PATH-shim.
 *
 * Что делаем:
 *   - detectRequiredNodeVersion: вытаскиваем требуемую версию из
 *     project-файлов в порядке приоритета:
 *       1. package.json#volta.node (точная закреплённая версия)
 *       2. .nvmrc (полная или partial версия)
 *       3. package.json#engines.node (semver range, берём major)
 *   - getSystemNodeVersion: какой node стоит глобально (для UI-сравнения)
 *   - getVoltaInfo: установлен ли Volta + какие Node-версии в нём есть
 *   - installVolta: однокликовая установка через winget/brew/script
 *   - installNodeViaVolta(versionSpec): `volta install node@<spec>`
 *
 * Скоуп — только Node. .NET / Python / etc — отдельные сервисы (Phase 2+).
 */

import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'

/**
 * @typedef {Object} RequiredNodeVersion
 * @property {string} version       semver-spec в формате, который понимает
 *                                  `volta install node@<spec>`: точная версия
 *                                  '18.17.0' либо major '18'.
 * @property {'volta'|'nvmrc'|'engines'} source   откуда взяли
 * @property {string} raw           исходное значение (для UI hint'ов)
 */

/**
 * @typedef {Object} VoltaInfo
 * @property {boolean} installed
 * @property {string|null} version          версия самого Volta'а
 * @property {string[]} nodeVersions         список установленных Node-версий
 *                                            (полные SemVer, как у `volta list`)
 */

/**
 * @param {string} repoPath
 * @returns {RequiredNodeVersion|null}
 */
export function detectRequiredNodeVersion(repoPath) {
  if (!repoPath) return null
  const pkgPath = path.join(repoPath, 'package.json')
  let pkg = null
  if (fs.existsSync(pkgPath)) {
    try {
      pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
    } catch {
      // ignore — package.json мог быть кривой JSON
    }
  }

  // 1. volta.node — точная закреплённая версия (Volta-конвенция)
  const voltaNode = pkg?.volta?.node
  if (typeof voltaNode === 'string' && voltaNode.trim()) {
    return {
      version: voltaNode.trim(),
      source: 'volta',
      raw: voltaNode.trim()
    }
  }

  // 2. .nvmrc — обычно либо '18' либо '18.17.0'
  const nvmrcPath = path.join(repoPath, '.nvmrc')
  if (fs.existsSync(nvmrcPath)) {
    try {
      const raw = fs.readFileSync(nvmrcPath, 'utf8').trim()
      if (raw) {
        // Normalize: убираем v-prefix если есть. 'v18.17.0' → '18.17.0'.
        const cleaned = raw.replace(/^v/i, '')
        return {
          version: cleaned,
          source: 'nvmrc',
          raw
        }
      }
    } catch {
      // ignore
    }
  }

  // 3. engines.node — semver-range, забираем major через regex.
  // Примеры: '>=18.0.0', '^18.17.0', '~16', '14.x', '18 || 20'.
  const engines = pkg?.engines?.node
  if (typeof engines === 'string' && engines.trim()) {
    const major = extractMajor(engines)
    if (major) {
      return {
        version: major,
        source: 'engines',
        raw: engines.trim()
      }
    }
  }

  return null
}

/**
 * Простой парсер: первая последовательность digit'ов в строке —
 * major version. Покрывает 95% случаев engines-range'ей. Для exotic
 * range'ей вроде '14.0.0 - 16.99.99' даст 14, что приемлемо (Volta
 * установит latest 14.x).
 */
function extractMajor(rangeStr) {
  const m = rangeStr.match(/(\d+)/)
  return m ? m[1] : null
}

/**
 * @returns {Promise<string|null>} '18.17.1' или null если node нет в PATH.
 */
export async function getSystemNodeVersion() {
  try {
    const { code, stdout } = await runCmd('node', ['--version'])
    if (code !== 0) return null
    return stdout.trim().replace(/^v/i, '')
  } catch {
    return null
  }
}

/**
 * @returns {Promise<VoltaInfo>}
 */
export async function getVoltaInfo() {
  // Volta version
  let installed = false
  let version = null
  try {
    const { code, stdout } = await runCmd('volta', ['--version'])
    if (code === 0) {
      installed = true
      version = stdout.trim()
    }
  } catch {
    // ignore — volta нет в PATH
  }

  if (!installed) {
    return { installed: false, version: null, nodeVersions: [] }
  }

  // Список установленных Node-версий: `volta list node --format plain`
  // выдаёт строки вида:
  //   runtime node@18.17.0 (current @ project, etc)
  //   runtime node@20.10.0 (default)
  // Парсим version после `node@`.
  let nodeVersions = []
  try {
    const { code, stdout } = await runCmd('volta', [
      'list',
      'node',
      '--format=plain'
    ])
    if (code === 0) {
      const set = new Set()
      for (const line of stdout.split(/\r?\n/)) {
        const m = line.match(/node@(\d[^\s]*)/)
        if (m) set.add(m[1])
      }
      nodeVersions = [...set]
    }
  } catch {
    // ignore
  }
  return { installed: true, version, nodeVersions }
}

/**
 * Платформенно-зависимая установка Volta:
 *   Windows  → winget install --id Volta.Volta -e --silent
 *   macOS    → brew install volta
 *   Linux    → curl https://get.volta.sh | bash
 *
 * Возвращает stream-friendly handle: { exitCode, stdout, stderr }.
 * Для UI прогресса — caller должен использовать onChunk callback
 * (пока не реализован, добавим если понадобится).
 *
 * @returns {Promise<{ ok: boolean, message: string }>}
 */
export async function installVolta() {
  const platform = process.platform
  let cmd, args, useShell
  if (platform === 'win32') {
    // winget доступен на Win10+ 1809 / Win11 default. Если нет — error.
    cmd = 'winget'
    args = ['install', '--id', 'Volta.Volta', '-e', '--silent']
    useShell = true // winget — .cmd-shim
  } else if (platform === 'darwin') {
    cmd = 'brew'
    args = ['install', 'volta']
    useShell = false
  } else {
    // Linux / другие unix: используем install-script. bash -c для
    // pipe'а из curl'а в bash.
    cmd = 'bash'
    args = ['-c', 'curl https://get.volta.sh | bash']
    useShell = false
  }

  let stdout = ''
  let stderr = ''
  try {
    const result = await runCmdWithShell(cmd, args, useShell)
    stdout = result.stdout
    stderr = result.stderr
    if (result.code === 0) {
      return {
        ok: true,
        message: `Volta installed. ${
          platform === 'win32'
            ? 'Restart WorkHelper so the new PATH takes effect.'
            : 'Open a new terminal session for PATH changes.'
        }`
      }
    }
    return {
      ok: false,
      message:
        (stderr.trim() || stdout.trim()).slice(-300) ||
        `Install command exited ${result.code}`
    }
  } catch (e) {
    if (e?.code === 'ENOENT') {
      return {
        ok: false,
        message:
          platform === 'win32'
            ? 'winget not found. Install from Microsoft Store (App Installer) or get Volta manually from https://volta.sh.'
            : platform === 'darwin'
            ? 'brew not found. Install Homebrew first: https://brew.sh — or get Volta from https://volta.sh.'
            : 'bash/curl not found. Get Volta manually from https://volta.sh.'
      }
    }
    return { ok: false, message: e?.message || String(e) }
  }
}

/**
 * `volta install node@<spec>`. Идемпотентно — если версия уже стоит,
 * Volta no-op'ит. Не пинит к проекту (для пина юзер сам делает
 * `volta pin` или мы добавим ручной hook позже).
 *
 * @param {string} versionSpec  '18', '18.17.0', etc.
 * @returns {Promise<{ ok: boolean, message: string }>}
 */
export async function installNodeViaVolta(versionSpec) {
  if (!versionSpec) {
    return { ok: false, message: 'No version specified' }
  }
  let result
  try {
    result = await runCmdWithShell(
      'volta',
      ['install', `node@${versionSpec}`],
      true // на Windows volta — `.exe`, но shell:true работает универсально
    )
  } catch (e) {
    if (e?.code === 'ENOENT') {
      return {
        ok: false,
        message: 'Volta not found in PATH. Install Volta first.'
      }
    }
    return { ok: false, message: e?.message || String(e) }
  }
  if (result.code === 0) {
    return {
      ok: true,
      message: `Node ${versionSpec} installed via Volta.`
    }
  }
  const detail = (result.stderr.trim() || result.stdout.trim()).slice(-300)
  return {
    ok: false,
    message: `volta install node@${versionSpec} failed: ${
      detail || `exit ${result.code}`
    }`
  }
}

/**
 * Совпадает ли установленная версия с required'ом. Считаем что match
 * если установленная начинается с required (для major-only spec'ов
 * типа '18'). Иначе exact equality.
 */
/**
 * Записывает `.nvmrc` в repoPath с указанной версией. После этого
 * Volta будет авто-роутить любые `node`/`npm`/`yarn` команды в этом
 * каталоге к нужной версии — наш существующий runPmCommand'у никаких
 * изменений не нужно.
 *
 * `.nvmrc` — индустриальный стандарт; конвенция чисто текстового
 * файла с версией внутри. Если юзер не хочет коммитить — добавит в
 * .gitignore. Альтернативой был бы wrap команд через `volta run`,
 * но это нужно делать в нескольких местах (orchestrator + process-
 * manager), а .nvmrc один раз и работает везде, включая user'ское
 * VSCode-терминал.
 *
 * @param {string} repoPath
 * @param {string} version  '16', '18.17.0', etc.
 * @returns {{ ok: boolean, message: string }}
 */
export function writeNvmrcForProject(repoPath, version) {
  if (!repoPath || !version) {
    return { ok: false, message: 'repoPath and version are required' }
  }
  if (!fs.existsSync(repoPath)) {
    return { ok: false, message: `Project path not found: ${repoPath}` }
  }
  const target = path.join(repoPath, '.nvmrc')
  try {
    fs.writeFileSync(target, `${String(version).trim()}\n`, 'utf8')
    return { ok: true, message: `Wrote ${target}` }
  } catch (e) {
    return { ok: false, message: `Failed to write .nvmrc: ${e?.message || e}` }
  }
}

/**
 * Это Node-проект? Используется UI чтобы показывать picker даже когда
 * required=null (нет engines/.nvmrc) — иначе для не-Node репо мы бы
 * предлагали выбрать Node-версию что бессмысленно.
 */
export function isNodeProject(repoPath) {
  if (!repoPath) return false
  return fs.existsSync(path.join(repoPath, 'package.json'))
}

export function nodeVersionSatisfies(installed, requiredSpec) {
  if (!installed || !requiredSpec) return false
  // Exact major (e.g. '18') — checks for '18.x.x' prefix.
  if (/^\d+$/.test(requiredSpec)) {
    return (
      installed === requiredSpec ||
      installed.startsWith(`${requiredSpec}.`)
    )
  }
  // Major.minor (e.g. '18.17') — prefix match.
  if (/^\d+\.\d+$/.test(requiredSpec)) {
    return (
      installed === requiredSpec ||
      installed.startsWith(`${requiredSpec}.`)
    )
  }
  // Полная версия — exact.
  return installed === requiredSpec
}

// ─── низкоуровневые spawn-helpers ───────────────────────────────────

function runCmd(cmd, args) {
  return runCmdWithShell(cmd, args, false)
}

function runCmdWithShell(cmd, args, useShell) {
  const isWin = process.platform === 'win32'
  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    let child
    try {
      // На Windows shell:true когда binary это .cmd-шим (winget, volta
      // ставится как .exe но safer через shell). На POSIX direct exec.
      child = spawn(
        useShell && isWin ? [cmd, ...args].join(' ') : cmd,
        useShell && isWin ? [] : args,
        {
          shell: useShell && isWin,
          windowsHide: true,
          env: process.env
        }
      )
    } catch (e) {
      reject(e)
      return
    }
    child.stdout?.on('data', (d) => {
      stdout += d.toString()
    })
    child.stderr?.on('data', (d) => {
      stderr += d.toString()
    })
    child.once('error', (e) => reject(e))
    child.once('exit', (code) => resolve({ code, stdout, stderr }))
  })
}
