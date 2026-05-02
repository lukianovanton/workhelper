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
import os from 'node:os'

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
 * Установка Volta без зависимости от пакетных менеджеров системы.
 * На каждой ОС качаем official-installer от volta-cli напрямую с
 * GitHub Releases и запускаем silent-режимом. Никаких winget /
 * brew / curl-bash требований к юзеру.
 *
 *   Windows → .msi с GitHub releases, msiexec /i ... /passive
 *   macOS   → .tar.gz с GitHub releases, разворачиваем в ~/.volta/bin
 *   Linux   → .tar.gz с GitHub releases, разворачиваем в ~/.volta/bin
 *
 * После успешной установки добавляем Volta-bin к process.env.PATH так
 * что subsequent spawn'ы видят `volta` без перезапуска приложения.
 * При следующем рестарте PATH обновлён уже системой (Volta-installer
 * сам прописывает USER PATH через registry/.profile).
 *
 * @returns {Promise<{ ok: boolean, message: string }>}
 */
export async function installVolta() {
  try {
    const platform = process.platform
    if (platform === 'win32') return installVoltaWindows()
    if (platform === 'darwin') return installVoltaUnix('darwin')
    return installVoltaUnix('linux')
  } catch (e) {
    return { ok: false, message: e?.message || String(e) }
  }
}

async function installVoltaWindows() {
  // 1. Скачиваем .msi последнего релиза с GitHub.
  const asset = await fetchLatestVoltaAsset(/windows-x86_64\.msi$/i)
  if (!asset.ok) return asset
  const tmpPath = path.join(
    os.tmpdir(),
    `volta-installer-${Date.now()}.msi`
  )
  const dl = await downloadFile(asset.url, tmpPath)
  if (!dl.ok) return dl

  // 2. Запускаем msiexec в passive-режиме (no UI input, но прогресс-бар
  // покажется системой — юзер видит, что что-то происходит). /norestart
  // чтобы не уйти в reboot тихо. Volta-MSI per-user, UAC обычно не
  // запрашивает.
  let result
  try {
    result = await runCmdWithShell(
      'msiexec',
      ['/i', tmpPath, '/passive', '/norestart'],
      false
    )
  } catch (e) {
    safeUnlink(tmpPath)
    return { ok: false, message: `msiexec failed to start: ${e?.message || e}` }
  }
  safeUnlink(tmpPath)

  // msiexec exit codes: 0 = success; 1641 = success but reboot initiated;
  // 3010 = success but reboot required. Любой из них считаем OK.
  if (result.code !== 0 && result.code !== 1641 && result.code !== 3010) {
    return {
      ok: false,
      message:
        `msiexec exited ${result.code}` +
        (result.stderr.trim() ? `: ${result.stderr.trim().slice(-200)}` : '')
    }
  }

  // 3. PATH-update в текущем процессе чтобы subsequent volta-команды
  // работали без рестарта приложения.
  ensureVoltaInPath()
  return {
    ok: true,
    message:
      'Volta installed. New PATH applied — you can pick a Node version now.'
  }
}

async function installVoltaUnix(kind) {
  // Pattern asset name: volta-X.Y.Z-{macos,linux}.tar.gz
  const re =
    kind === 'darwin' ? /macos\.tar\.gz$/i : /linux\.tar\.gz$/i
  const asset = await fetchLatestVoltaAsset(re)
  if (!asset.ok) return asset
  const home = os.homedir()
  const voltaDir = path.join(home, '.volta')
  const binDir = path.join(voltaDir, 'bin')
  fs.mkdirSync(binDir, { recursive: true })

  const tmpPath = path.join(
    os.tmpdir(),
    `volta-installer-${Date.now()}.tar.gz`
  )
  const dl = await downloadFile(asset.url, tmpPath)
  if (!dl.ok) return dl

  // tar -xzf <archive> -C <binDir> --strip-components=0
  let result
  try {
    result = await runCmdWithShell('tar', ['-xzf', tmpPath, '-C', binDir], false)
  } catch (e) {
    safeUnlink(tmpPath)
    return { ok: false, message: `tar failed: ${e?.message || e}` }
  }
  safeUnlink(tmpPath)
  if (result.code !== 0) {
    return {
      ok: false,
      message: `tar exited ${result.code}: ${result.stderr.trim().slice(-200)}`
    }
  }
  // chmod +x на распакованных бинарях
  try {
    for (const name of fs.readdirSync(binDir)) {
      const full = path.join(binDir, name)
      const stat = fs.statSync(full)
      if (stat.isFile()) fs.chmodSync(full, 0o755)
    }
  } catch {
    // ignore
  }
  ensureVoltaInPath()
  return {
    ok: true,
    message:
      `Volta installed in ${voltaDir}. New PATH applied — you can pick a Node version now. Open a new terminal session for permanent PATH update.`
  }
}

/**
 * GitHub Releases API → находит подходящий asset под наш regex.
 */
async function fetchLatestVoltaAsset(nameRegex) {
  let res
  try {
    res = await fetch(
      'https://api.github.com/repos/volta-cli/volta/releases/latest',
      {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'WorkHelper'
        }
      }
    )
  } catch (e) {
    return {
      ok: false,
      message: `Could not reach GitHub API: ${e?.message || e}`
    }
  }
  if (!res.ok) {
    return {
      ok: false,
      message: `GitHub API returned ${res.status}`
    }
  }
  const release = await res.json()
  const asset = (release.assets || []).find((a) => nameRegex.test(a.name || ''))
  if (!asset) {
    return {
      ok: false,
      message: `No matching Volta asset in latest release (${release.tag_name}).`
    }
  }
  return {
    ok: true,
    url: asset.browser_download_url,
    name: asset.name
  }
}

async function downloadFile(url, destPath) {
  let res
  try {
    res = await fetch(url, {
      headers: { 'User-Agent': 'WorkHelper' }
    })
  } catch (e) {
    return { ok: false, message: `Download failed: ${e?.message || e}` }
  }
  if (!res.ok) {
    return { ok: false, message: `Download HTTP ${res.status}` }
  }
  try {
    const buf = Buffer.from(await res.arrayBuffer())
    fs.writeFileSync(destPath, buf)
  } catch (e) {
    return {
      ok: false,
      message: `Failed to write installer to disk: ${e?.message || e}`
    }
  }
  return { ok: true }
}

function safeUnlink(p) {
  try {
    fs.unlinkSync(p)
  } catch {
    // ignore
  }
}

/**
 * Пушим Volta-bin в process.env.PATH если его там ещё нет. Так
 * subsequent `volta`-команды (через spawn) находят бинарь без
 * рестарта приложения. На системном уровне PATH обновляется самим
 * MSI/архивом — это эффективно при следующем запуске.
 */
function ensureVoltaInPath() {
  const home =
    os.homedir() ||
    process.env.USERPROFILE ||
    process.env.HOME ||
    ''
  const candidates = []
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local')
    candidates.push(path.join(local, 'Volta', 'bin'))
  }
  candidates.push(path.join(home, '.volta', 'bin'))
  const existing = candidates.find((c) => fs.existsSync(c))
  if (!existing) return
  const sep = process.platform === 'win32' ? ';' : ':'
  const segs = (process.env.PATH || '').split(sep)
  if (!segs.some((s) => s.toLowerCase() === existing.toLowerCase())) {
    process.env.PATH = `${existing}${sep}${process.env.PATH || ''}`
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
