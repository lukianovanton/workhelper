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
  // ⚠️ Legacy: оставлены для миграции с до-A.4b/A.5b версии. После
  // первого getConfig() значения переезжают в sources[0] / databases[0].
  bitbucket: {
    workspace: '',
    username: '',
    gitUsername: ''
  },
  paths: {
    projectsRoot: 'C:\\Projects',
    dumpsRoot: '',
    vscodeExecutable: 'code'
  },
  database: {
    host: 'localhost',
    port: 3306,
    user: 'root',
    mysqlExecutable: ''
  },
  dotnet: {
    runArgs: [],
    workingDirSubpathOverride: {}
  },
  presence: {
    enabled: false
  },
  jira: {
    host: '',
    email: ''
  }
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
 * `sources[0]` и legacy `database: {}` → `databases[0]`. Если новая
 * форма уже заполнена — только зачищает дубли в legacy-полях. Если
 * не заполнена и legacy пуста — оставляет как есть.
 *
 * @param {AppConfig} config
 * @returns {AppConfig}
 */
function migrateConfig(config) {
  let next = config
  let mutated = false

  // --- Sources -------------------------------------------------------
  const sources = Array.isArray(next.sources) ? next.sources : []
  const bb = next.bitbucket || {}
  const hasLegacyBb = !!(bb.workspace || bb.username || bb.gitUsername)

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
    next = {
      ...next,
      sources: [migrated],
      bitbucket: { workspace: '', username: '', gitUsername: '' }
    }
    mutated = true
  } else if (sources.length > 0 && hasLegacyBb) {
    next = {
      ...next,
      bitbucket: { workspace: '', username: '', gitUsername: '' }
    }
    mutated = true
  }

  // --- Databases -----------------------------------------------------
  const databases = Array.isArray(next.databases) ? next.databases : []
  const db = next.database || {}
  const hasLegacyDb =
    !!(db.host || db.user || db.mysqlExecutable) ||
    typeof db.port === 'number' && db.port > 0

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
    next = {
      ...next,
      databases: [migrated],
      database: { host: '', port: 0, user: '', mysqlExecutable: '' }
    }
    mutated = true
  } else if (databases.length > 0 && hasLegacyDb) {
    next = {
      ...next,
      database: { host: '', port: 0, user: '', mysqlExecutable: '' }
    }
    mutated = true
  }

  if (mutated) {
    store.store = next
  }
  return next
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
