/**
 * Резолв абсолютного пути к бинарю по имени.
 * На Windows — `where.exe`, на *nix — `which`.
 *
 * Используется в Settings для отображения «detected: <abs>» под полями,
 * где допустим как имя в PATH, так и абсолютный путь (vscodeExecutable,
 * mysqlExecutable).
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

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
