/**
 * Реестр сконфигурированных DB-подключений.
 *
 * На входе — список Database-объектов:
 *   `{ id, type, name, host, port, user, executable, secretKey }`
 * На выходе — engine'ы (build-once-per-id, кэшированные).
 *
 * Phase A.5a: список синтезируется на лету из legacy `config.database`
 * (один engine с id='mysql-default'). В Phase A.5b — переход на
 * `config.databases[]` напрямую.
 *
 * Создание engine'а ленивое и memoized по id, чтобы restoreJobs Map
 * не сбрасывалась на каждый getEngine().
 *
 * @typedef {import('./types.js').DbEngine} DbEngine
 */

import { getConfig } from '../config-store.js'
import { getSecret } from '../secrets.js'
import {
  getDbEngineDef,
  isSupportedDbType,
  defaultDbNameFor
} from './engines.js'

/**
 * @typedef {Object} DbConfigEntry
 * @property {string} id
 * @property {string} type             'mysql' | 'postgres' | <future>
 * @property {string} name
 * @property {string} host
 * @property {number} port
 * @property {string} user
 * @property {string} executable
 * @property {string} secretKey
 */

/**
 * @returns {DbConfigEntry[]}
 */
function getDatabases() {
  const config = getConfig()
  const databases = Array.isArray(config.databases) ? config.databases : []
  return databases
    .filter((d) => d && isSupportedDbType(d.type))
    .map((d) => {
      const def = getDbEngineDef(d.type)
      return {
        id: d.id,
        type: d.type,
        name:
          d.name ||
          (d.host ? `${d.user || d.type}@${d.host}` : def.fallbackName),
        host: d.host || '',
        port: d.port || def.defaultPort,
        user: d.user || '',
        executable: d.executable || '',
        secretKey: `db:${d.id}:password`
      }
    })
}

/** @type {Map<string, DbEngine>} */
const engines = new Map()

function buildEngine(entry) {
  const def = getDbEngineDef(entry.type)
  if (!def) {
    throw new Error(`Unknown DB engine type: ${entry.type}`)
  }
  // Lazy-getters: каждый раз перечитываем актуальную запись из конфига,
  // чтобы edits в Settings подхватывались без пересоздания инстанса
  // (restoreJobs Map пережил бы такие правки, что важно).
  return def.factory({
    getHost: () => {
      const fresh = getDatabases().find((e) => e.id === entry.id)
      return fresh?.host || entry.host
    },
    getPort: () => {
      const fresh = getDatabases().find((e) => e.id === entry.id)
      return fresh?.port || entry.port
    },
    getUser: () => {
      const fresh = getDatabases().find((e) => e.id === entry.id)
      return fresh?.user || entry.user
    },
    getPassword: () => getSecret(entry.secretKey),
    getExecutable: () => {
      const fresh = getDatabases().find((e) => e.id === entry.id)
      return fresh?.executable || entry.executable
    }
  })
}

/**
 * Engine по id. null если такого нет.
 *
 * @param {string} dbId
 * @returns {DbEngine | null}
 */
export function getEngine(dbId) {
  const entry = getDatabases().find((e) => e.id === dbId)
  if (!entry) return null
  if (!engines.has(dbId)) {
    engines.set(dbId, buildEngine(entry))
  }
  return engines.get(dbId)
}

/**
 * Default engine — первый сконфигурированный. Используется для enrich
 * (одно подключение для всех проектов на этом этапе) и для текущих
 * shim-вызовов, где project ↔ engine mapping ещё не введён.
 *
 * @returns {DbEngine | null}
 */
export function getDefaultEngine() {
  const entries = getDatabases()
  if (entries.length === 0) return null
  return getEngine(entries[0].id)
}

/**
 * Возвращает engine для проекта. Читает override из
 * config.databaseOverrides[slug].databaseId; если не задан или указанный
 * engine не существует — fallback на default.
 *
 * @param {string} slug
 * @returns {DbEngine | null}
 */
export function getEngineForProject(slug) {
  const config = getConfig()
  const ov = (config.databaseOverrides || {})[slug] || {}
  if (ov.databaseId) {
    const engine = getEngine(ov.databaseId)
    if (engine) return engine
  }
  return getDefaultEngine()
}

/**
 * Полный резолв per-project DB: какой engine использовать и под каким
 * именем. Имя БД по умолчанию = slug.toLowerCase(); override в
 * config.databaseOverrides[slug].name перебивает.
 *
 * @param {string} slug
 * @returns {{ engineId: string|null, engine: DbEngine|null, dbName: string }}
 */
export function resolveProjectDb(slug) {
  const config = getConfig()
  const ov = (config.databaseOverrides || {})[slug] || {}

  let engine = null
  let engineId = null
  let engineType = null
  if (ov.databaseId) {
    engine = getEngine(ov.databaseId)
    if (engine) {
      engineId = ov.databaseId
      engineType = engine.type
    }
  }
  if (!engine) {
    const dbs = getDatabases()
    if (dbs.length > 0) {
      engineId = dbs[0].id
      engine = getEngine(engineId)
      engineType = dbs[0].type
    }
  }
  // Имя БД: explicit override > per-engine normalize(slug). Раньше тут
  // был хардкод slug.toLowerCase() — для будущих движков типа Mongo
  // (допускают дефис) дефолтная нормализация может отличаться.
  const dbName =
    (ov.name && ov.name.trim()) || defaultDbNameFor(engineType, slug)
  return { engineId, engine, dbName }
}

export function listDatabaseConfigs() {
  return getDatabases().map((d) => ({
    id: d.id,
    type: d.type,
    name: d.name
  }))
}

/**
 * Сбросить кэшированные engine'ы. Вызывать при изменении конфигурации.
 */
export function invalidateEngines() {
  for (const eng of engines.values()) {
    try {
      eng.killAllRestores()
    } catch {
      // ignore
    }
  }
  engines.clear()
}

/**
 * Гасит все живые restore-процессы во всех сконфигурированных
 * engine'ах. Вызывается на before-quit.
 */
export function killAllRestoresAcrossEngines() {
  for (const entry of getDatabases()) {
    const eng = getEngine(entry.id)
    if (!eng) continue
    try {
      eng.killAllRestores()
    } catch {
      // ignore
    }
  }
}
