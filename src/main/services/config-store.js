/**
 * Persistent app config (без секретов — те через secrets.js).
 *
 * electron-store v8 (CJS). Файл лежит в `app.getPath('userData')/config.json`.
 *
 * Phase A.4b добавил `sources: []` (массив VCS-источников). При
 * каждом чтении конфига выполняется миграция: если sources пуст и
 * существует legacy `bitbucket.{workspace}` — оттуда создаётся
 * `bitbucket-default` source, и legacy-поле очищается. Так старые
 * установки апгрейдятся бесшовно при следующем запуске.
 *
 * @typedef {import('../../shared/types.js').AppConfig} AppConfig
 * @typedef {import('../../shared/types.js').VcsSourceConfig} VcsSourceConfig
 */

import Store from 'electron-store'

/** @type {AppConfig} */
const DEFAULTS = {
  sources: [],
  databases: [],
  defaults: {
    runCommand: 'dotnet run'
  },
  runOverrides: {},
  databaseOverrides: {},
  paths: {
    projectsRoot: 'C:\\Projects',
    dumpsRoot: '',
    vscodeExecutable: 'code'
  },
  presence: {
    enabled: true
  },
  jira: {
    host: '',
    email: ''
  }
  // Legacy ключи bitbucket / database / dotnet больше не в DEFAULTS.
  // Если они остались на диске у апгрейдящегося пользователя,
  // electron-store всё равно их прочитает; migrateConfig() ниже
  // переносит данные и удаляет ключи из persisted state.
}

const store = new Store({
  name: 'config',
  defaults: DEFAULTS,
  clearInvalidConfig: true
})

const DEFAULT_BB_SOURCE_ID = 'bitbucket-default'
const DEFAULT_MYSQL_DB_ID = 'mysql-default'

/**
 * Идемпотентная миграция: переносит legacy `bitbucket: {}` →
 * `sources[0]`, `database: {}` → `databases[0]`,
 * `dotnet: {}` → `defaults.runCommand` + `runOverrides[slug].cwd`.
 *
 * После переноса legacy-ключи удаляются из persisted state. На
 * повторных вызовах без legacy ничего не делает.
 *
 * @param {AppConfig & { bitbucket?: any, database?: any, dotnet?: any }} config
 * @returns {AppConfig}
 */
function migrateConfig(config) {
  let next = config
  let mutated = false

  // --- Sources (legacy bitbucket → sources[0]) ----------------------
  const sources = Array.isArray(next.sources) ? next.sources : []
  const bb = next.bitbucket || {}
  const hasLegacyBb =
    next.bitbucket !== undefined &&
    (!!bb.workspace || !!bb.username || !!bb.gitUsername)

  if (sources.length === 0 && hasLegacyBb) {
    /** @type {VcsSourceConfig} */
    const migrated = {
      id: DEFAULT_BB_SOURCE_ID,
      type: 'bitbucket',
      name: bb.workspace || 'Bitbucket',
      workspace: bb.workspace || '',
      username: bb.username || '',
      gitUsername: bb.gitUsername || ''
    }
    next = withoutKey({ ...next, sources: [migrated] }, 'bitbucket')
    mutated = true
  } else if (next.bitbucket !== undefined) {
    next = withoutKey(next, 'bitbucket')
    mutated = true
  }

  // --- Run command (legacy dotnet → defaults + runOverrides) -------
  const dotnet = next.dotnet || {}
  const hasLegacyDotnet =
    next.dotnet !== undefined &&
    ((Array.isArray(dotnet.runArgs) && dotnet.runArgs.length > 0) ||
      (dotnet.workingDirSubpathOverride &&
        Object.keys(dotnet.workingDirSubpathOverride).length > 0))

  if (hasLegacyDotnet) {
    const defaults = next.defaults || {}
    const overrides = { ...(next.runOverrides || {}) }

    let nextDefaults = defaults
    if (!defaults.runCommand || defaults.runCommand === 'dotnet run') {
      const args = dotnet.runArgs || []
      const cmd = ['dotnet', 'run', ...args].join(' ').trim()
      if (cmd && cmd !== defaults.runCommand) {
        nextDefaults = { ...defaults, runCommand: cmd }
      }
    }
    const subpaths = dotnet.workingDirSubpathOverride || {}
    for (const [slug, sub] of Object.entries(subpaths)) {
      if (!sub) continue
      const existing = overrides[slug] || {}
      if (!existing.cwd) {
        overrides[slug] = { ...existing, cwd: sub }
      }
    }
    next = withoutKey(
      { ...next, defaults: nextDefaults, runOverrides: overrides },
      'dotnet'
    )
    mutated = true
  } else if (next.dotnet !== undefined) {
    next = withoutKey(next, 'dotnet')
    mutated = true
  }

  // --- Databases (legacy database → databases[0]) ------------------
  const databases = Array.isArray(next.databases) ? next.databases : []
  const db = next.database || {}
  const hasLegacyDb =
    next.database !== undefined &&
    (!!db.host ||
      !!db.user ||
      !!db.mysqlExecutable ||
      (typeof db.port === 'number' && db.port > 0))

  if (databases.length === 0 && hasLegacyDb) {
    /** @type {DbConnectionConfig} */
    const migrated = {
      id: DEFAULT_MYSQL_DB_ID,
      type: 'mysql',
      name: db.host ? `${db.user || 'mysql'}@${db.host}` : 'MySQL',
      host: db.host || 'localhost',
      port: db.port || 3306,
      user: db.user || 'root',
      executable: db.mysqlExecutable || ''
    }
    next = withoutKey({ ...next, databases: [migrated] }, 'database')
    mutated = true
  } else if (next.database !== undefined) {
    next = withoutKey(next, 'database')
    mutated = true
  }

  if (mutated) {
    store.store = next
  }
  return next
}

function withoutKey(obj, key) {
  if (!Object.prototype.hasOwnProperty.call(obj, key)) return obj
  const { [key]: _omit, ...rest } = obj
  return rest
}

/**
 * @returns {AppConfig}
 */
export function getConfig() {
  return migrateConfig(store.store)
}

/**
 * Глубоко мерджит patch в текущий конфиг и сохраняет.
 * Не валидирует структуру — фронт отвечает за корректность.
 *
 * Для `sources: [...]` deepMerge-логика подходит плохо (массив надо
 * заменять целиком, а не мерджить по ключу). Поэтому если patch
 * содержит `sources`, они затирают существующий массив.
 *
 * @param {Partial<AppConfig>} patch
 */
export function setConfig(patch) {
  const current = store.store
  const merged = deepMerge(current, patch)
  // Sources всегда заменяем целиком, не мерджим — иначе deepMerge
  // склеивает массивы по индексу (не наша семантика).
  if (Array.isArray(patch?.sources)) {
    merged.sources = patch.sources
  }
  if (Array.isArray(patch?.databases)) {
    merged.databases = patch.databases
  }
  // runOverrides / databaseOverrides — { [slug]: {...} }. deepMerge не
  // удаляет ключи: если пользователь убрал override (delete map[slug]),
  // мердж бы оставил старую запись. Для этих структур patch считается
  // полным новым значением, как sources/databases.
  if (patch && Object.prototype.hasOwnProperty.call(patch, 'runOverrides')) {
    merged.runOverrides = patch.runOverrides || {}
  }
  if (
    patch &&
    Object.prototype.hasOwnProperty.call(patch, 'databaseOverrides')
  ) {
    merged.databaseOverrides = patch.databaseOverrides || {}
  }
  store.store = merged
}

function deepMerge(target, source) {
  if (!isPlainObject(target) || !isPlainObject(source)) return source
  const out = { ...target }
  for (const [key, value] of Object.entries(source)) {
    if (isPlainObject(value) && isPlainObject(target[key])) {
      out[key] = deepMerge(target[key], value)
    } else {
      out[key] = value
    }
  }
  return out
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

export { DEFAULTS, DEFAULT_BB_SOURCE_ID, DEFAULT_MYSQL_DB_ID }
