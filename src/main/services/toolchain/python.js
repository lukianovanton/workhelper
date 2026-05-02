/**
 * Python detector + installer.
 *
 * Зачем нам Python: node-gyp использует Python-скрипты для генерации
 * проектных файлов (binding.gyp). Без Python даже с Build Tools
 * нативная сборка падает.
 *
 * Detect: проверяем `python --version`, `python3 --version`, `py
 * --version` (Windows-only py launcher). На Windows 10/11 без
 * установленного Python команда python.exe — это shim'ка из Microsoft
 * Store, которая выводит сообщение "Python was not found; run without
 * arguments to install from the Microsoft Store" и НЕ возвращает
 * версию. Считаем такой случай за "not installed".
 *
 * Install: качаем official installer Python 3 с python.org. Размер
 * ~25MB. Устанавливаем в quiet-режиме per-user (без админа).
 *   InstallAllUsers=0    — per-user
 *   PrependPath=1        — добавить в PATH
 *   Include_test=0       — не нужно нам
 *
 * Запасной вариант: winget install Python.Python.3.12 — но не у всех
 * winget работает, поэтому direct download надёжнее.
 */

import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

// Стабильная LTS-ветка для node-gyp. node-gyp требует Python 3.6+,
// 3.12 — текущая стабильная (на момент написания).
const PYTHON_VERSION = '3.12.7'
const PYTHON_INSTALLER_URL_WIN = `https://www.python.org/ftp/python/${PYTHON_VERSION}/python-${PYTHON_VERSION}-amd64.exe`

/**
 * @returns {Promise<{
 *   installed: boolean,
 *   version: string | null,
 *   path: string | null
 * }>}
 */
export async function getPythonInfo() {
  // Пробуем все обычные команды. Первая, которая отдаёт ВЕРСИЮ
  // (не stub-сообщение), считается installed.
  const candidates =
    process.platform === 'win32'
      ? ['py', 'python', 'python3']
      : ['python3', 'python']
  for (const cmd of candidates) {
    try {
      const result = await runCmd(cmd, ['--version'])
      const out = (result.stdout + result.stderr).trim()
      // Stub'ка от Microsoft Store содержит «not found» / «Microsoft
      // Store». Реальный python печатает «Python 3.X.Y».
      const m = out.match(/Python\s+(\d+\.\d+\.\d+)/i)
      if (m && !/microsoft store|not found/i.test(out)) {
        // Где он лежит?
        let pathOut = ''
        try {
          const w = await runCmd(
            process.platform === 'win32' ? 'where' : 'which',
            [cmd]
          )
          pathOut = (w.stdout || '').split(/\r?\n/)[0].trim()
        } catch {
          // ignore
        }
        return { installed: true, version: m[1], path: pathOut || cmd }
      }
    } catch {
      // ENOENT — пробуем следующий
    }
  }
  return { installed: false, version: null, path: null }
}

/**
 * @returns {Promise<{ ok: boolean, cancelled?: boolean, message: string }>}
 */
export async function installPython() {
  if (process.platform !== 'win32') {
    return {
      ok: false,
      message:
        'Python auto-install on this platform not implemented. Install Python 3 manually.'
    }
  }
  // 1. Download official Windows installer (~25MB).
  const tmpPath = path.join(
    os.tmpdir(),
    `python-installer-${Date.now()}.exe`
  )
  const dl = await downloadFile(PYTHON_INSTALLER_URL_WIN, tmpPath)
  if (!dl.ok) return dl

  // 2. Run quiet per-user install. PrependPath=1 чтобы PATH сразу
  // подхватился (для нашего process'а — only system-wide PATH;
  // user PATH обновится после рестарта).
  let result
  try {
    result = await runCmd(tmpPath, [
      '/quiet',
      'InstallAllUsers=0',
      'PrependPath=1',
      'Include_test=0',
      'Include_doc=0',
      'Include_dev=0',
      'Include_launcher=1'
    ])
  } catch (e) {
    safeUnlink(tmpPath)
    return {
      ok: false,
      message: `Python installer failed to launch: ${e?.message || e}`
    }
  }
  safeUnlink(tmpPath)

  // Python installer exit codes — обычно 0 на success, ненулевой на
  // failure. Cancel UAC обычно даёт exit code != 0.
  if (result.code === 0) {
    // PATH-update для текущего процесса. Per-user install обычно идёт
    // в %LOCALAPPDATA%\Programs\Python\Python<XY>.
    ensurePythonInPath()
    return {
      ok: true,
      message: `Python ${PYTHON_VERSION} installed. PATH updated for this session; restart shell for permanent PATH.`
    }
  }
  if (result.code === 1602 || result.code === 1223) {
    return {
      ok: false,
      cancelled: true,
      message: 'Python installation cancelled.'
    }
  }
  return {
    ok: false,
    message: `Python installer exited with code ${result.code}.`
  }
}

/**
 * После Python install, ищем его в обычных местах и пушим в PATH.
 */
function ensurePythonInPath() {
  if (process.platform !== 'win32') return
  const local = process.env.LOCALAPPDATA || ''
  if (!local) return
  const programsRoot = path.join(local, 'Programs', 'Python')
  if (!fs.existsSync(programsRoot)) return
  let entries = []
  try {
    entries = fs.readdirSync(programsRoot)
  } catch {
    return
  }
  // Берём самую свежую версию (Python311, Python312, etc.). Сортируем
  // по имени desc — обычно совпадает с numerical desc.
  const candidates = entries
    .filter((e) => /^Python\d+/i.test(e))
    .sort()
    .reverse()
  for (const dir of candidates) {
    const root = path.join(programsRoot, dir)
    const pyExe = path.join(root, 'python.exe')
    if (!fs.existsSync(pyExe)) continue
    const scriptsDir = path.join(root, 'Scripts')
    const segs = (process.env.PATH || '').split(';')
    const lower = segs.map((s) => s.toLowerCase())
    if (!lower.includes(root.toLowerCase())) {
      process.env.PATH = `${root};${process.env.PATH || ''}`
    }
    if (
      fs.existsSync(scriptsDir) &&
      !lower.includes(scriptsDir.toLowerCase())
    ) {
      process.env.PATH = `${scriptsDir};${process.env.PATH || ''}`
    }
    break
  }
}

// ─── helpers ─────────────────────────────────────────────────────

function runCmd(cmd, args) {
  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    let child
    try {
      child = spawn(cmd, args, { windowsHide: true, env: process.env })
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

async function downloadFile(url, destPath) {
  let res
  try {
    res = await fetch(url, { headers: { 'User-Agent': 'WorkHelper' } })
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
      message: `Failed to write installer: ${e?.message || e}`
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
