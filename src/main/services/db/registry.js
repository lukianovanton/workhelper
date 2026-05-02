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

const DEFAULT_MYSQL_DB_ID = 'mysql-default'

/**
 * @typedef {Object} DbConfigEntry
 * @property {string} id
 * @property {'mysql'} type
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
  const db = config.database || {}
  return [
    {
      id: DEFAULT_MYSQL_DB_ID,
      type: 'mysql',
      name: db.host ? `${db.user}@${db.host}` : 'MySQL',
      host: db.host || '',
      port: db.port || 3306,
      user: db.user || '',
      executable: db.mysqlExecutable || '',
      secretKey: 'dbPassword'
    }
  ]
}

/** @type {Map<string, DbEngine>} */
const engines = new Map()

function buildEngine(entry) {
  if (entry.type !== 'mysql') {
    throw new Error(`Unknown DB engine type: ${entry.type}`)
  }
  return createMysqlEngine({
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
