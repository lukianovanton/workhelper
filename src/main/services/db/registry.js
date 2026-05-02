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
import { createMysqlEngine } from './mysql-engine.js'
import { createPostgresEngine } from './postgres-engine.js'

/**
 * @typedef {Object} DbConfigEntry
 * @property {string} id
 * @property {'mysql' | 'postgres'} type
 * @property {string} name
 * @property {string} host
 * @property {number} port
 * @property {string} user
 * @property {string} executable
 * @property {string} secretKey
 */

const SUPPORTED_TYPES = new Set(['mysql', 'postgres'])
const DEFAULT_PORTS = { mysql: 3306, postgres: 5432 }

/**
 * @returns {DbConfigEntry[]}
 */
function getDatabases() {
  const config = getConfig()
  const databases = Array.isArray(config.databases) ? config.databases : []
  return databases
    .filter((d) => d && SUPPORTED_TYPES.has(d.type))
    .map((d) => ({
      id: d.id,
      type: d.type,
      name:
        d.name ||
        (d.host
          ? `${d.user || d.type}@${d.host}`
          : d.type === 'postgres'
          ? 'PostgreSQL'
          : 'MySQL'),
      host: d.host || '',
      port: d.port || DEFAULT_PORTS[d.type],
      user: d.user || '',
      executable: d.executable || '',
      secretKey: `db:${d.id}:password`
    }))
}

/** @type {Map<string, DbEngine>} */
const engines = new Map()

function buildEngine(entry) {
  // Lazy-getters: каждый раз перечитываем актуальную запись из конфига,
  // чтобы edits в Settings подхватывались без пересоздания инстанса
  // (restoreJobs Map пережил бы такие правки, что важно).
  const lazy = {
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
  }
  if (entry.type === 'mysql') return createMysqlEngine(lazy)
  if (entry.type === 'postgres') return createPostgresEngine(lazy)
  throw new Error(`Unknown DB engine type: ${entry.type}`)
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
 * Возвращает engine для проекта. На момент A.5a игнорирует projectSlug
 * и всегда отдаёт default — но контракт стабильный, в A.5b/A.6 здесь
 * добавится lookup по `Project.databaseId`.
 *
 * @returns {DbEngine | null}
 */
export function getEngineForProject(_projectSlug) {
  return getDefaultEngine()
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
