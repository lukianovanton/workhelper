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
 * Поиск дампа по разделу 9.4: `{dumpsRoot}/{slugLower}.sql`,
 * `.sql.gz`, или `{slugUpper}.sql`. Первый существующий — возвращаем.
 *
 * @param {string} dumpsRoot
 * @param {string} slug
 * @returns {Promise<string|null>}
 */
export async function findDump(dumpsRoot, slug) {
  if (!dumpsRoot) return null
  const slugLower = slug.toLowerCase()
  const slugUpper = slug.toUpperCase()
  const candidates = [
    path.join(dumpsRoot, `${slugLower}.sql`),
    path.join(dumpsRoot, `${slugLower}.sql.gz`),
    path.join(dumpsRoot, `${slugUpper}.sql`)
  ]
  for (const c of candidates) {
    try {
      const stat = await fsp.stat(c)
      if (stat.isFile()) return c
    } catch {
      // not found — try next
    }
  }
  return null
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
