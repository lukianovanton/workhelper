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

// Маркеры зависимостей-БД для разных стеков. Каждый regex проверяется
// против релевантного manifest-файла; первый матч → needsDatabase=true.
// Список консервативно расширяемый — лучше пропустить «нужна» (показать
// чекбокс пред-выключенным) чем накручивать ложноположительные.
const DOTNET_DB_PATTERNS = [
  /"ConnectionStrings"\s*:/i,
  /Microsoft\.EntityFrameworkCore/i,
  /System\.Data\.SqlClient/i,
  /Npgsql/i,
  /MySqlConnector/i,
  /Dapper/i
]
const NODE_DB_DEPS = new Set([
  'pg',
  'mysql',
  'mysql2',
  'sqlite3',
  'better-sqlite3',
  'mongodb',
  'mongoose',
  'redis',
  'ioredis',
  'typeorm',
  'sequelize',
  'prisma',
  '@prisma/client',
  'knex',
  'drizzle-orm',
  'kysely',
  'pg-promise'
])
const CARGO_DB_PATTERNS = [
  /^\s*sqlx\s*=/m,
  /^\s*diesel\s*=/m,
  /^\s*tokio-postgres\s*=/m,
  /^\s*postgres\s*=/m,
  /^\s*mysql\s*=/m,
  /^\s*rusqlite\s*=/m,
  /^\s*sea-orm\s*=/m
]
const GO_DB_PATTERNS = [
  /\sdatabase\/sql\b/,
  /github\.com\/lib\/pq\b/,
  /github\.com\/go-sql-driver\/mysql\b/,
  /github\.com\/jackc\/pgx\b/,
  /gorm\.io\/gorm\b/,
  /github\.com\/jmoiron\/sqlx\b/
]

async function detectDotnet(repoRoot) {
  const subpath = await resolveRunnableSubpath(repoRoot, '', {})
  if (!subpath) return null
  // Проверяем наличие БД через содержимое appsettings*.json в runnable-папке.
  const targetDir = path.join(repoRoot, subpath)
  let needsDb = false
  try {
    const entries = await fsp.readdir(targetDir)
    for (const f of entries) {
      if (!/^appsettings(\..+)?\.json$/i.test(f)) continue
      try {
        const raw = await fsp.readFile(path.join(targetDir, f), 'utf8')
        if (DOTNET_DB_PATTERNS.some((re) => re.test(raw))) {
          needsDb = true
          break
        }
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore
  }
  // Дополнительно: csproj может референсить EF Core / Npgsql без
  // отдельного appsettings (например, infra-only проекты).
  if (!needsDb) {
    try {
      const entries = await fsp.readdir(targetDir)
      for (const f of entries) {
        if (!/\.csproj$/i.test(f)) continue
        try {
          const raw = await fsp.readFile(path.join(targetDir, f), 'utf8')
          if (DOTNET_DB_PATTERNS.some((re) => re.test(raw))) {
            needsDb = true
            break
          }
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore
    }
  }
  return {
    stackKind: 'dotnet',
    runCommand: 'dotnet run',
    cwd: subpath,
    needsDatabase: needsDb
  }
}

async function detectNode(repoRoot) {
  const pkgPath = path.join(repoRoot, 'package.json')
  if (!(await fileExists(pkgPath))) return null
  let pkgManager = 'npm'
  if (await fileExists(path.join(repoRoot, 'pnpm-lock.yaml'))) {
    pkgManager = 'pnpm'
  } else if (await fileExists(path.join(repoRoot, 'yarn.lock'))) {
    pkgManager = 'yarn'
  }
  let runCommand = `${pkgManager} start`
  let needsDb = false
  try {
    const raw = await fsp.readFile(pkgPath, 'utf8')
    const pkg = JSON.parse(raw)
    const scripts = pkg.scripts || {}
    const script = ['dev', 'start', 'serve'].find((s) => scripts[s])
    if (script) {
      runCommand =
        pkgManager === 'npm'
          ? `npm run ${script}`
          : `${pkgManager} ${script}`
    }
    const allDeps = {
      ...(pkg.dependencies || {}),
      ...(pkg.devDependencies || {}),
      ...(pkg.peerDependencies || {}),
      ...(pkg.optionalDependencies || {})
    }
    for (const dep of Object.keys(allDeps)) {
      if (NODE_DB_DEPS.has(dep)) {
        needsDb = true
        break
      }
    }
  } catch {
    // оставляем дефолты
  }
  return {
    stackKind: 'node',
    runCommand,
    cwd: '',
    needsDatabase: needsDb
  }
}

async function detectCargo(repoRoot) {
  const cargoPath = path.join(repoRoot, 'Cargo.toml')
  if (!(await fileExists(cargoPath))) return null
  let needsDb = false
  try {
    const raw = await fsp.readFile(cargoPath, 'utf8')
    needsDb = CARGO_DB_PATTERNS.some((re) => re.test(raw))
  } catch {
    // ignore
  }
  return {
    stackKind: 'cargo',
    runCommand: 'cargo run',
    cwd: '',
    needsDatabase: needsDb
  }
}

async function detectGo(repoRoot) {
  const goModPath = path.join(repoRoot, 'go.mod')
  if (!(await fileExists(goModPath))) return null
  let needsDb = false
  try {
    const raw = await fsp.readFile(goModPath, 'utf8')
    needsDb = GO_DB_PATTERNS.some((re) => re.test(raw))
    // go.mod часто содержит только direct deps; если там пусто — пробуем
    // главный source-файл (быстрая эвристика без полного walk'а).
  } catch {
    // ignore
  }
  return {
    stackKind: 'go',
    runCommand: 'go run .',
    cwd: '',
    needsDatabase: needsDb
  }
}

async function detectMake(repoRoot) {
  for (const name of ['Makefile', 'makefile', 'GNUmakefile']) {
    if (await fileExists(path.join(repoRoot, name))) {
      return {
        stackKind: 'make',
        runCommand: 'make run',
        cwd: '',
        needsDatabase: false
      }
    }
  }
  return null
}

/**
 * Эвристика типа стека по содержимому корня клонированного репо.
 * Возвращает stackKind / runCommand / cwd и needsDatabase — флаг
 * того, что в проекте находятся явные следы работы с БД (EF Core,
 * pg/mysql/prisma в node_modules, sqlx в Cargo.toml, и т.д.).
 *
 * needsDatabase консервативный: при срабатывании любого паттерна =
 * true, иначе false. Цель — не угадывать на 100%, а подсунуть
 * пользователю разумный дефолт чекбокса «Set up a database».
 *
 * @param {string} repoRoot
 * @returns {Promise<{
 *   stackKind: string|null,
 *   runCommand: string|null,
 *   cwd: string,
 *   needsDatabase: boolean
 * }>}
 */
export async function detectStack(repoRoot) {
  if (!repoRoot) {
    return { stackKind: null, runCommand: null, cwd: '', needsDatabase: false }
  }
  // Приоритет: .NET → Node → Cargo → Go → Make. Первый совпавший
  // detector определяет стек.
  const detectors = [detectDotnet, detectNode, detectCargo, detectGo, detectMake]
  for (const d of detectors) {
    const res = await d(repoRoot)
    if (res) return res
  }
  return { stackKind: null, runCommand: null, cwd: '', needsDatabase: false }
}

/**
 * Тонкий wrapper над detectStack для обратной совместимости —
 * RunOverrideSection в drawer'е продолжает использовать только
 * { runCommand, cwd } и не интересуется needsDatabase.
 *
 * @param {string} repoRoot
 * @returns {Promise<{ runCommand: string|null, cwd: string }>}
 */
export async function detectRunCommand(repoRoot) {
  const r = await detectStack(repoRoot)
  return { runCommand: r.runCommand, cwd: r.cwd }
}
