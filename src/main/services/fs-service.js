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

// Маркеры конкретного DB engine'а для разных стеков. Использует
// resolveEngineFromText в databases:detectForProject когда имя БД не
// совпадает со slug'ом (проект `AffiliateCRM` ↔ база `qacrm` — fuzzy
// match невозможен, но движок мы определим и подсветим правильное
// подключение, оставив юзеру только выбор имени БД).
//
// Формат: список tuples `{ engineId, patterns: RegExp[] }`. Каждый
// engineId должен совпадать с ключом в DB_ENGINE_DEFS (см. db/engines.js).
// Скейл: добавление mssql / mongo = добавить tuple, не трогать
// resolveEngineFromText.
//
// Принцип резолва: если матчатся два разных engine'а одновременно —
// ambiguous, возвращаем null. Лучше null, чем неверная подсказка.
const DOTNET_ENGINE_SIGNALS = [
  {
    engineId: 'postgres',
    patterns: [
      /Npgsql/i,
      /Pomelo\.EntityFrameworkCore\.PostgreSQL/i,
      /Npgsql\.EntityFrameworkCore\.PostgreSQL/i,
      // Connection-string маркеры из appsettings.json. Port=5432 — дефолт-
      // ный порт Postgres'а; Host= в EF/Npgsql conn-string'е использует-
      // ся только у Postgres (MySQL / MSSQL пишут Server=).
      /Port\s*=\s*5432\b/i,
      /Host\s*=[^;]*;[^"]*Database\s*=/i
    ]
  },
  {
    engineId: 'mysql',
    patterns: [
      /MySqlConnector/i,
      /Pomelo\.EntityFrameworkCore\.MySql/i,
      /MySql\.Data\b/i,
      // Port=3306 — дефолтный порт MySQL'а. Server= в conn-string ambi-
      // guous (используется и у MSSQL), поэтому только в паре с явным
      // MySQL-портом.
      /Port\s*=\s*3306\b/i
    ]
  }
]
const NODE_ENGINE_DEP_SETS = [
  { engineId: 'postgres', deps: new Set(['pg', 'pg-promise', 'postgres']) },
  { engineId: 'mysql', deps: new Set(['mysql', 'mysql2']) }
]
const CARGO_ENGINE_SIGNALS = [
  {
    engineId: 'postgres',
    patterns: [/^\s*tokio-postgres\s*=/m, /^\s*postgres\s*=/m, /\bpostgres\b/i]
  },
  { engineId: 'mysql', patterns: [/^\s*mysql\s*=/m] }
]
const GO_ENGINE_SIGNALS = [
  {
    engineId: 'postgres',
    patterns: [/github\.com\/lib\/pq\b/, /github\.com\/jackc\/pgx\b/]
  },
  {
    engineId: 'mysql',
    patterns: [/github\.com\/go-sql-driver\/mysql\b/]
  }
]

/**
 * Резолвит engine по списку tuple'ов `{ engineId, patterns }`:
 * пробегает все tuple'ы, собирает engineId'ы, чьи patterns матчатся.
 * Если ровно один — возвращает его. Иначе null (ambiguous либо ничего
 * не нашли).
 */
function resolveEngineFromText(text, engineSignals) {
  const matched = new Set()
  for (const { engineId, patterns } of engineSignals) {
    if (patterns.some((re) => re.test(text))) matched.add(engineId)
  }
  return matched.size === 1 ? [...matched][0] : null
}

function resolveEngineFromDeps(allDeps, depSets) {
  const matched = new Set()
  for (const { engineId, deps } of depSets) {
    if (Object.keys(allDeps).some((d) => deps.has(d))) matched.add(engineId)
  }
  return matched.size === 1 ? [...matched][0] : null
}

async function detectDotnet(repoRoot) {
  const subpath = await resolveRunnableSubpath(repoRoot, '', {})
  if (!subpath) return null

  // Собираем текст из:
  //   1. appsettings*.json в runnable-папке (connection strings)
  //   2. ВСЕХ *.csproj в корне репо и в subdir'ах глубины 1
  //
  // Расширили scope (раньше брали только runnable-папку): в типичной
  // .NET-солюшене Npgsql/MySqlConnector часто живёт в библиотечном
  // проекте (DataAccess/DataAccess.csproj) — runnable-csproj его лишь
  // ProjectReference'ит и не содержит явных пакетов. Без обхода
  // sibling'ов databaseEngine получался null для большинства реальных
  // солюшенов.
  let fileText = ''
  const targetDir = path.join(repoRoot, subpath)
  try {
    const entries = await fsp.readdir(targetDir)
    for (const f of entries) {
      if (!/^appsettings(\..+)?\.json$/i.test(f)) continue
      try {
        fileText += '\n' + (await fsp.readFile(path.join(targetDir, f), 'utf8'))
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore
  }

  // .csproj-файлы: root level + 1 уровень subdir'ов. Глубже не лезем
  // (хватает «standard» структуры src/<Project>/Project.csproj). Это
  // подсчитано как ~10-30 fs.readdir на репо — не критично.
  const csprojTargets = []
  try {
    const rootEntries = await fsp.readdir(repoRoot, { withFileTypes: true })
    for (const e of rootEntries) {
      if (e.isFile() && /\.csproj$/i.test(e.name)) {
        csprojTargets.push(path.join(repoRoot, e.name))
      } else if (e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules') {
        const subDir = path.join(repoRoot, e.name)
        try {
          const subEntries = await fsp.readdir(subDir)
          for (const f of subEntries) {
            if (/\.csproj$/i.test(f)) {
              csprojTargets.push(path.join(subDir, f))
            }
          }
        } catch {
          // ignore — могла быть restricted папка
        }
      }
    }
  } catch {
    // ignore
  }
  for (const p of csprojTargets) {
    try {
      fileText += '\n' + (await fsp.readFile(p, 'utf8'))
    } catch {
      // ignore
    }
  }

  const needsDb = DOTNET_DB_PATTERNS.some((re) => re.test(fileText))
  const databaseEngine = resolveEngineFromText(fileText, DOTNET_ENGINE_SIGNALS)

  return {
    stackKind: 'dotnet',
    runCommand: 'dotnet run',
    cwd: subpath,
    needsDatabase: needsDb,
    databaseEngine
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
  let databaseEngine = null
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
    databaseEngine = resolveEngineFromDeps(allDeps, NODE_ENGINE_DEP_SETS)
  } catch {
    // оставляем дефолты
  }
  return {
    stackKind: 'node',
    runCommand,
    cwd: '',
    needsDatabase: needsDb,
    databaseEngine
  }
}

async function detectCargo(repoRoot) {
  const cargoPath = path.join(repoRoot, 'Cargo.toml')
  if (!(await fileExists(cargoPath))) return null
  let needsDb = false
  let databaseEngine = null
  try {
    const raw = await fsp.readFile(cargoPath, 'utf8')
    needsDb = CARGO_DB_PATTERNS.some((re) => re.test(raw))
    databaseEngine = resolveEngineFromText(raw, CARGO_ENGINE_SIGNALS)
  } catch {
    // ignore
  }
  return {
    stackKind: 'cargo',
    runCommand: 'cargo run',
    cwd: '',
    needsDatabase: needsDb,
    databaseEngine
  }
}

async function detectGo(repoRoot) {
  const goModPath = path.join(repoRoot, 'go.mod')
  if (!(await fileExists(goModPath))) return null
  let needsDb = false
  let databaseEngine = null
  try {
    const raw = await fsp.readFile(goModPath, 'utf8')
    needsDb = GO_DB_PATTERNS.some((re) => re.test(raw))
    databaseEngine = resolveEngineFromText(raw, GO_ENGINE_SIGNALS)
    // go.mod часто содержит только direct deps; если там пусто — пробуем
    // главный source-файл (быстрая эвристика без полного walk'а).
  } catch {
    // ignore
  }
  return {
    stackKind: 'go',
    runCommand: 'go run .',
    cwd: '',
    needsDatabase: needsDb,
    databaseEngine
  }
}

async function detectMake(repoRoot) {
  for (const name of ['Makefile', 'makefile', 'GNUmakefile']) {
    if (await fileExists(path.join(repoRoot, name))) {
      return {
        stackKind: 'make',
        runCommand: 'make run',
        cwd: '',
        needsDatabase: false,
        databaseEngine: null
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
 *   needsDatabase: boolean,
 *   databaseEngine: string|null
 * }>}
 *
 * databaseEngine — id из DB_ENGINE_DEFS (см. db/engines.js): 'mysql',
 * 'postgres', и т.д. Список расширяется добавлением tuple'ов в
 * DOTNET_ENGINE_SIGNALS / NODE_ENGINE_DEP_SETS / etc. — без правки
 * resolveEngineFromText / resolveEngineFromDeps.
 */
export async function detectStack(repoRoot) {
  if (!repoRoot) {
    return {
      stackKind: null,
      runCommand: null,
      cwd: '',
      needsDatabase: false,
      databaseEngine: null
    }
  }
  // Приоритет: .NET → Node → Cargo → Go → Make. Первый совпавший
  // detector определяет стек.
  const detectors = [detectDotnet, detectNode, detectCargo, detectGo, detectMake]
  for (const d of detectors) {
    const res = await d(repoRoot)
    if (res) return res
  }
  return {
    stackKind: null,
    runCommand: null,
    cwd: '',
    needsDatabase: false,
    databaseEngine: null
  }
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

// --- Remote (pre-clone) stack detection -----------------------------
//
// detectStackRemote(provider, slug) тянет минимальный набор файлов
// через VcsProvider.{listRootFiles, getFileText} и применяет ту же
// логику что и локальный detectStack. Цель — наполнить SetupDialog
// разумными defaults ДО клона.
//
// Ограничения:
//   - .NET: остаёмся на root level. Если в корне есть `*.sln` или
//     `*.csproj` — детектим как dotnet, но cwd не считаем (требует
//     лазанья по subdirs; локальный resolveRunnableSubpath это делает
//     post-clone). needsDatabase для удалённого .NET сейчас не пытаемся
//     определить — слишком много сабфолдеров; локальный детект уточнит
//     после клона.
//   - Node / Cargo / Go — fetch'им один manifest и применяем те же
//     паттерны что локально.

/**
 * @param {import('./vcs/types.js').VcsProvider} provider
 * @param {string} slug
 * @returns {Promise<{
 *   stackKind: string|null,
 *   runCommand: string|null,
 *   cwd: string,
 *   needsDatabase: boolean
 * }>}
 */
export async function detectStackRemote(provider, slug) {
  const empty = {
    stackKind: null,
    runCommand: null,
    cwd: '',
    needsDatabase: false
  }
  if (!provider || !slug) return empty
  if (typeof provider.listRootFiles !== 'function') return empty

  let names
  try {
    names = await provider.listRootFiles(slug)
  } catch {
    return empty
  }
  if (!Array.isArray(names) || names.length === 0) return empty
  const set = new Set(names.map((n) => n.toLowerCase()))

  // 1. .NET (по root-маркерам). cwd оставляем '' — после клона
  // локальный detectStack это уточнит.
  const hasSln = names.some((n) => /\.sln$/i.test(n))
  const hasCsproj = names.some((n) => /\.csproj$/i.test(n))
  if (hasSln || hasCsproj) {
    return {
      stackKind: 'dotnet',
      runCommand: 'dotnet run',
      cwd: '',
      needsDatabase: false
    }
  }

  // 2. Node
  if (set.has('package.json')) {
    let pkgManager = 'npm'
    if (set.has('pnpm-lock.yaml')) pkgManager = 'pnpm'
    else if (set.has('yarn.lock')) pkgManager = 'yarn'

    let runCommand = `${pkgManager} start`
    let needsDb = false
    try {
      const raw = await provider.getFileText(slug, 'package.json')
      if (raw) {
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
      }
    } catch {
      // ignore — оставляем дефолты
    }
    return {
      stackKind: 'node',
      runCommand,
      cwd: '',
      needsDatabase: needsDb
    }
  }

  // 3. Cargo
  if (set.has('cargo.toml')) {
    let needsDb = false
    try {
      const raw = await provider.getFileText(slug, 'Cargo.toml')
      if (raw) needsDb = CARGO_DB_PATTERNS.some((re) => re.test(raw))
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

  // 4. Go
  if (set.has('go.mod')) {
    let needsDb = false
    try {
      const raw = await provider.getFileText(slug, 'go.mod')
      if (raw) needsDb = GO_DB_PATTERNS.some((re) => re.test(raw))
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

  // 5. Makefile
  if (set.has('makefile') || set.has('gnumakefile')) {
    return {
      stackKind: 'make',
      runCommand: 'make run',
      cwd: '',
      needsDatabase: false
    }
  }

  return empty
}
