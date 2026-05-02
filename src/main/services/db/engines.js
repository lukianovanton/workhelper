/**
 * Backend-side реестр DB-engine'ов. Замещает прежние if-каскады
 * (`if (type === 'mysql') ... if (type === 'postgres')`) которые
 * жили в registry.js, databases.ipc.js, и т.д.
 *
 * Контракт `factory(lazy)` единый: получает getHost/getPort/getUser/
 * getPassword/getExecutable, возвращает DbEngine.
 *
 * Также храним метаданные, которые раньше дублировались в нескольких
 * if-ладдерах: defaultPort, defaultUser, fallbackName, executableName
 * (имя бинарника для path-detect), nameRegex (валидация имени БД,
 * специфичная для движка — у Mongo например другая).
 *
 * @typedef {import('./types.js').DbEngine} DbEngine
 *
 * @typedef {Object} DbEngineLazyOpts
 * @property {() => string} getHost
 * @property {() => number} getPort
 * @property {() => string} getUser
 * @property {() => string|null} getPassword
 * @property {() => string} getExecutable
 *
 * @typedef {Object} DbEngineDef
 * @property {(opts: DbEngineLazyOpts) => DbEngine} factory
 * @property {number} defaultPort
 * @property {string} defaultUser
 * @property {string} fallbackName        человеческое имя по-умолчанию
 * @property {string} executableName      имя бинарника для path-detect
 *                                          (whichBinary / executable hint)
 * @property {RegExp} nameRegex           что считается валидным именем БД
 *                                          на этом движке. Mongo например
 *                                          допускает дефисы.
 * @property {(slug: string) => string} normalizeDbName
 *                                          slug → имя БД по-умолчанию.
 *                                          Для SQL'ей это lowercase;
 *                                          для движков с другими правилами
 *                                          переопределяется.
 */

import { createMysqlEngine } from './mysql-engine.js'
import { createPostgresEngine } from './postgres-engine.js'

const SQL_NAME_REGEX = /^[a-z0-9_]+$/
const sqlNormalize = (slug) => (slug || '').toLowerCase()

/** @type {Record<string, DbEngineDef>} */
export const DB_ENGINE_DEFS = {
  mysql: {
    factory: createMysqlEngine,
    defaultPort: 3306,
    defaultUser: 'root',
    fallbackName: 'MySQL',
    executableName: 'mysql',
    nameRegex: SQL_NAME_REGEX,
    normalizeDbName: sqlNormalize
  },
  postgres: {
    factory: createPostgresEngine,
    defaultPort: 5432,
    defaultUser: 'postgres',
    fallbackName: 'PostgreSQL',
    executableName: 'psql',
    nameRegex: SQL_NAME_REGEX,
    normalizeDbName: sqlNormalize
  }
}

export function getDbEngineDef(type) {
  return DB_ENGINE_DEFS[type] || null
}

export function isSupportedDbType(type) {
  return !!DB_ENGINE_DEFS[type]
}

export function listDbEngineTypes() {
  return Object.keys(DB_ENGINE_DEFS)
}

/**
 * Дефолтное имя БД для проекта на указанном engine. Если type unknown —
 * SQL-конвенция (lowercase). Используется в enrich / orchestrator чтобы
 * не закладывать `slug.toLowerCase()` в каждой точке использования.
 */
export function defaultDbNameFor(type, slug) {
  const def = getDbEngineDef(type)
  return def ? def.normalizeDbName(slug) : sqlNormalize(slug)
}
