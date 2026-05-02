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
  // ⚠️ Legacy: оставлены для миграции с до-A.4b версии. После
  // первого getConfig() значения переезжают в sources[0].
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

/**
 * Если legacy `bitbucket.workspace` есть, а sources пуст —
 * создаём `bitbucket-default` source и очищаем legacy поле. Идемпотентно:
 * на повторных вызовах ничего не делает.
 *
 * Сохранение в store происходит только если действительно мигрировали,
 * чтобы не плодить лишние записи.
 *
 * @param {AppConfig} config
 * @returns {AppConfig}
 */
function migrateConfig(config) {
  const sources = Array.isArray(config.sources) ? config.sources : []
  const bb = config.bitbucket || {}
  const hasLegacy =
    !!(bb.workspace || bb.username || bb.gitUsername)

  // Уже мигрировано — sources заполнен, legacy либо пуст, либо
  // дубль. Возвращаем без изменений.
  if (sources.length > 0) {
    if (hasLegacy) {
      // Legacy поля могут остаться от предыдущей версии — стираем,
      // чтобы UI не путался какой объект считать source-of-truth.
      const cleared = {
        ...config,
        bitbucket: { workspace: '', username: '', gitUsername: '' }
      }
      store.store = cleared
      return cleared
    }
    return config
  }

  if (!hasLegacy) {
    // Чистая первая установка: пустые sources, пустой legacy.
    return config
  }

  /** @type {VcsSourceConfig} */
  const migrated = {
    id: DEFAULT_BB_SOURCE_ID,
    type: 'bitbucket',
    name: bb.workspace || 'Bitbucket',
    workspace: bb.workspace || '',
    username: bb.username || '',
    gitUsername: bb.gitUsername || ''
  }
  const next = {
    ...config,
    sources: [migrated],
    bitbucket: { workspace: '', username: '', gitUsername: '' }
  }
  store.store = next
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

export { DEFAULTS, DEFAULT_BB_SOURCE_ID }
