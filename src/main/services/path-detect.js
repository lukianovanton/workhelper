/**
 * Резолв абсолютного пути к бинарю по имени.
 * На Windows — `where.exe`, на *nix — `which`.
 *
 * Используется в Settings для отображения «detected: <abs>» под полями,
 * где допустим как имя в PATH, так и абсолютный путь (vscodeExecutable,
 * mysqlExecutable).
 *
 * Для приложений, которые часто ставятся НЕ в PATH (mysql, VS Code в
 * %LOCALAPPDATA%), есть fallback по известным install-путям Windows.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import fsp from 'node:fs/promises'

const execFileAsync = promisify(execFile)

/**
 * @param {string} name
 * @returns {Promise<string|null>}
 */
export async function whichBinary(name) {
  if (!name || typeof name !== 'string') return null

  // Если уже абсолютный путь — вернуть как есть, не вызывая resolver
  const looksAbsolute =
    process.platform === 'win32'
      ? /^[a-z]:[\\/]/i.test(name) || name.startsWith('\\\\')
      : name.startsWith('/')
  if (looksAbsolute) return name

  const fromPath = await lookupOnPath(name)
  if (fromPath) return fromPath

  // PATH не нашёл — пробуем известные install-локации (Windows-only)
  return findKnownInstallPath(name)
}

async function lookupOnPath(name) {
  const cmd = process.platform === 'win32' ? 'where' : 'which'
  try {
    const { stdout } = await execFileAsync(cmd, [name], { windowsHide: true })
    const lines = stdout
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)

    if (process.platform === 'win32') {
      // `where code` на Windows выдаёт несколько матчей в недетерминированном
      // порядке: .exe, безрасширенный bash-скрипт (как `code` от VS Code),
      // .cmd-обёртка. spawn'ить безрасширенный файл Windows не умеет — будет
      // ENOENT. Предпочитаем настоящие исполняемые: .exe → .cmd → .bat → .com.
      const winExt = ['.exe', '.cmd', '.bat', '.com']
      for (const ext of winExt) {
        const hit = lines.find((l) => l.toLowerCase().endsWith(ext))
        if (hit) return hit
      }
    }

    return lines[0] || null
  } catch {
    return null
  }
}

/**
 * Стандартные install-локации Windows для известных приложений.
 * Расширяй по мере добавления новых бинарей в Settings.
 *
 * mysql:
 *   - C:\Program Files\MySQL\MySQL Server X.Y\bin\mysql.exe (берём
 *     самую свежую по сорту имени папки)
 *   - то же самое в "Program Files (x86)"
 *
 * code (VS Code):
 *   - %LOCALAPPDATA%\Programs\Microsoft VS Code\Code.exe (user install)
 *   - C:\Program Files\Microsoft VS Code\Code.exe (system install)
 *   - то же самое в "Program Files (x86)"
 *
 * @param {string} name
 * @returns {Promise<string|null>}
 */
async function findKnownInstallPath(name) {
  if (process.platform !== 'win32') return null

  if (name === 'mysql') {
    const roots = [
      'C:\\Program Files\\MySQL',
      'C:\\Program Files (x86)\\MySQL'
    ]
    for (const root of roots) {
      const candidate = await findLatestMysqlServer(root)
      if (candidate) return candidate
    }
    return null
  }

  if (name === 'code') {
    const candidates = [
      process.env.LOCALAPPDATA &&
        path.join(
          process.env.LOCALAPPDATA,
          'Programs',
          'Microsoft VS Code',
          'Code.exe'
        ),
      'C:\\Program Files\\Microsoft VS Code\\Code.exe',
      'C:\\Program Files (x86)\\Microsoft VS Code\\Code.exe'
    ].filter(Boolean)
    for (const c of candidates) {
      if (await fileExists(c)) return c
    }
    return null
  }

  return null
}

async function findLatestMysqlServer(root) {
  let entries
  try {
    entries = await fsp.readdir(root, { withFileTypes: true })
  } catch {
    return null
  }
  const serverDirs = entries
    .filter((e) => e.isDirectory() && /^MySQL Server/i.test(e.name))
    .map((e) => e.name)
    .sort() // 8.0, 8.1, 8.4 — лексикографический сорт даёт «свежее в конце»
    .reverse()
  for (const dir of serverDirs) {
    const candidate = path.join(root, dir, 'bin', 'mysql.exe')
    if (await fileExists(candidate)) return candidate
  }
  return null
}

async function fileExists(p) {
  try {
    const s = await fsp.stat(p)
    return s.isFile()
  } catch {
    return false
  }
}
