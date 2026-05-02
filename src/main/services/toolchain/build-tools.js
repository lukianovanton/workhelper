/**
 * Visual Studio Build Tools detector + installer (Windows-only).
 *
 * Build Tools предоставляют MSVC compiler + MSBuild + Windows SDK,
 * без которых node-gyp падает на любых нативных модулях (node-sass,
 * bcrypt, sharp, canvas, sqlite3 и пр.).
 *
 * Detect: запускаем `vswhere -all -products * -format json` и парсим.
 * vswhere — официальный bundled tool, устанавливается VS Setup'ом.
 * Если самого vswhere нет — Build Tools тоже нет (ничего не ставило
 * vswhere'а).
 *
 * Install: качаем `vs_BuildTools.exe` (online installer, ~3MB) с
 * официальной evergreen-ссылки aka.ms/vs/17/release/. Запускаем с
 * параметрами:
 *   --add Microsoft.VisualStudio.Workload.VCTools
 *   --includeRecommended
 *   --quiet --wait --norestart
 *
 * VCTools workload = MSVC build tools + Windows SDK + CMake. Это
 * минимум для node-gyp. ~2GB на диске. UAC-prompt при старте; после
 * этого юзер не нужен, инсталлер качает компоненты в фоне.
 *
 * НЕТ admin = НЕТ Build Tools. Это требование Microsoft, не наш
 * выбор. Если юзер откажется от UAC — возвращаем error с понятным
 * сообщением.
 */

import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

const VSWHERE_PATH =
  'C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe'
const BUILD_TOOLS_INSTALLER_URL =
  'https://aka.ms/vs/17/release/vs_BuildTools.exe'

/**
 * @returns {Promise<{
 *   installed: boolean,
 *   instances: Array<{
 *     installationPath: string,
 *     displayName: string,
 *     installationVersion: string,
 *     hasMSVC: boolean
 *   }>
 * }>}
 */
export async function getBuildToolsInfo() {
  if (process.platform !== 'win32') {
    return { installed: false, instances: [], notApplicable: true }
  }
  if (!fs.existsSync(VSWHERE_PATH)) {
    return { installed: false, instances: [] }
  }
  let stdout = ''
  try {
    const result = await runCmd(VSWHERE_PATH, [
      '-all',
      '-products',
      '*',
      '-format',
      'json',
      '-utf8'
    ])
    stdout = result.stdout
    if (result.code !== 0) {
      return { installed: false, instances: [], rawError: result.stderr }
    }
  } catch (e) {
    return {
      installed: false,
      instances: [],
      rawError: e?.message || String(e)
    }
  }
  let parsed = []
  try {
    parsed = JSON.parse(stdout)
  } catch {
    return { installed: false, instances: [] }
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    return { installed: false, instances: [] }
  }
  // Для каждой инсталляции проверим наличие MSVC. vswhere выдаёт
  // также `packages`-инфу через -include packages, но проще проверить
  // что директория VC/Tools/MSVC существует.
  const instances = parsed.map((inst) => {
    const installationPath = inst.installationPath || ''
    let hasMSVC = false
    try {
      const msvcDir = path.join(installationPath, 'VC', 'Tools', 'MSVC')
      hasMSVC = fs.existsSync(msvcDir) && fs.readdirSync(msvcDir).length > 0
    } catch {
      hasMSVC = false
    }
    return {
      installationPath,
      displayName: inst.displayName || '',
      installationVersion: inst.installationVersion || '',
      hasMSVC
    }
  })
  const anyWithMSVC = instances.some((i) => i.hasMSVC)
  return { installed: anyWithMSVC, instances }
}

/**
 * Скачивает + запускает vs_BuildTools.exe в quiet-режиме.
 * Возвращается после того как installer закончил (--wait).
 *
 * Юзер увидит UAC-prompt в начале. Дальше installer тихо качает
 * компоненты (~2GB). Cancel в Windows-инсталлере = exit code 1602
 * (USER_EXIT) — это OK сценарий, считаем `cancelled: true`.
 *
 * @returns {Promise<{ ok: boolean, cancelled?: boolean, message: string }>}
 */
export async function installBuildTools() {
  if (process.platform !== 'win32') {
    return {
      ok: false,
      message: 'Visual Studio Build Tools — only on Windows.'
    }
  }
  // 1. Download installer (это просто launcher, ~3-5MB; полные
  // компоненты он сам потом тянет).
  const tmpPath = path.join(
    os.tmpdir(),
    `vs_BuildTools-${Date.now()}.exe`
  )
  const dl = await downloadFile(BUILD_TOOLS_INSTALLER_URL, tmpPath)
  if (!dl.ok) return dl

  // 2. Запускаем. --quiet = no UI, --wait = block till done,
  //    --norestart = не перезагружать машину автоматически.
  //    Workload VCTools — MSVC + Windows SDK + CMake (то что нужно
  //    node-gyp). includeRecommended добавит ATL/MFC по дефолту,
  //    лишним не будет.
  let result
  try {
    result = await runCmd(tmpPath, [
      '--quiet',
      '--wait',
      '--norestart',
      '--add',
      'Microsoft.VisualStudio.Workload.VCTools',
      '--includeRecommended'
    ])
  } catch (e) {
    safeUnlink(tmpPath)
    return {
      ok: false,
      message: `Build Tools installer failed to launch: ${
        e?.message || e
      }`
    }
  }
  safeUnlink(tmpPath)

  // Exit codes (документация Microsoft):
  //   0    — успех
  //   3010 — успех, но требуется reboot
  //   1602 — пользователь отменил установку (UAC отказ ИЛИ закрыл
  //          installer)
  //   1603 — fatal error
  //   другие — см. docs.microsoft.com
  if (result.code === 0 || result.code === 3010) {
    return {
      ok: true,
      message:
        result.code === 3010
          ? 'Visual Studio Build Tools installed. Reboot recommended for changes to take full effect.'
          : 'Visual Studio Build Tools installed.'
    }
  }
  if (result.code === 1602) {
    return {
      ok: false,
      cancelled: true,
      message: 'Installation cancelled by user.'
    }
  }
  return {
    ok: false,
    message: `Build Tools installer exited with code ${result.code}. See %TEMP%\\dd_setup_*.log for details.`
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
