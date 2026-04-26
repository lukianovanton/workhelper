/**
 * Файловые операции для enrich:
 *  - projectPath / projectExists — есть ли клон на диске
 *  - findDump — поиск SQL-дампа по слагу (раздел 9.4)
 *  - resolveRunnableSubpath — путь к папке с Program.cs (раздел 9.5)
 */

import path from 'node:path'
import fs from 'node:fs'
import fsp from 'node:fs/promises'

/**
 * @param {string} projectsRoot
 * @param {string} slug
 * @returns {string} абсолютный путь к папке проекта (slug.toLowerCase())
 */
export function projectPath(projectsRoot, slug) {
  return path.join(projectsRoot, slug.toLowerCase())
}

/**
 * @param {string} projectsRoot
 * @param {string} slug
 * @returns {boolean}
 */
export function projectExists(projectsRoot, slug) {
  if (!projectsRoot) return false
  try {
    return fs.statSync(projectPath(projectsRoot, slug)).isDirectory()
  } catch {
    return false
  }
}

/**
 * Поиск дампа в dumpsRoot. Имена файлов в реальности нерегулярные:
 *  - `{slug}.sql` / `{slug}.sql.gz` (теоретический идеал спеки)
 *  - `dump-{SLUG}-{timestamp}` (как у пользователя — без расширения)
 *  - смесь форматов
 *
 * Стратегия: читаем папку, фильтруем case-insensitive по двум
 * паттернам: имя начинается со slug, либо начинается с `dump-{slug}`.
 * Из подходящих берём свежайший по mtime — если в папке накопились
 * бэкапы за разные даты, подхватываем последний.
 *
 * Расширение игнорируем: формат gzip определяется по содержимому
 * в restoreDatabase (магические байты 0x1f 0x8b).
 *
 * @param {string} dumpsRoot
 * @param {string} slug
 * @returns {Promise<{path: string, filename: string, mtime: number}|null>}
 */
export async function findDump(dumpsRoot, slug) {
  if (!dumpsRoot) return null

  let entries
  try {
    entries = await fsp.readdir(dumpsRoot, { withFileTypes: true })
  } catch {
    return null
  }

  const slugLower = slug.toLowerCase()
  const dumpPrefix = `dump-${slugLower}`

  const matches = entries.filter((e) => {
    if (!e.isFile()) return false
    const lower = e.name.toLowerCase()
    return lower.startsWith(slugLower) || lower.startsWith(dumpPrefix)
  })

  if (matches.length === 0) return null

  const stats = await Promise.all(
    matches.map(async (e) => {
      const full = path.join(dumpsRoot, e.name)
      try {
        const s = await fsp.stat(full)
        return { path: full, filename: e.name, mtime: s.mtimeMs }
      } catch {
        return null
      }
    })
  )

  const valid = stats
    .filter((x) => x != null)
    .sort((a, b) => b.mtime - a.mtime)

  return valid[0] || null
}

/**
 * Резолв workingDirSubpath по спеке 9.5. Возвращает относительный
 * путь от корня репо до runnable-проекта (где лежит Program.cs).
 *
 *  1. override из config.dotnet.workingDirSubpathOverride[slugLower]
 *     (если задан и Program.cs там есть)
 *  2. <BrandName>/ — где BrandName = basename(*.sln)
 *  3. fallback: любая папка с Program.cs рядом с *.csproj
 *
 * BusinessLogic / DataAccess / Utils — библиотечные .csproj без
 * Program.cs, в кандидаты не попадают по определению.
 *
 * @param {string} repoRoot           абс. путь к корню репо
 * @param {string} slugLower
 * @param {Record<string,string>=} overrides   карта slug → подпуть
 * @returns {Promise<string|null>}
 */
export async function resolveRunnableSubpath(repoRoot, slugLower, overrides) {
  if (!repoRoot) return null

  // 1. override
  const override = overrides?.[slugLower]
  if (override) {
    const programCs = path.join(repoRoot, override, 'Program.cs')
    if (await fileExists(programCs)) return override
  }

  let entries
  try {
    entries = await fsp.readdir(repoRoot, { withFileTypes: true })
  } catch {
    return null
  }

  // 2. *.sln → BrandName → BrandName/Program.cs
  const slnEntry = entries.find(
    (e) => e.isFile() && e.name.toLowerCase().endsWith('.sln')
  )
  if (slnEntry) {
    const brand = slnEntry.name.slice(0, -'.sln'.length)
    const programCs = path.join(repoRoot, brand, 'Program.cs')
    if (await fileExists(programCs)) return brand
  }

  // 3. fallback: scan one level deep for csproj+Program.cs
  for (const e of entries) {
    if (!e.isDirectory()) continue
    const dir = path.join(repoRoot, e.name)
    let inner
    try {
      inner = await fsp.readdir(dir)
    } catch {
      continue
    }
    const hasProgram = inner.includes('Program.cs')
    const hasCsproj = inner.some((f) => f.toLowerCase().endsWith('.csproj'))
    if (hasProgram && hasCsproj) return e.name
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
