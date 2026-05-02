/**
 * Тонкий shim над `db/mysql-engine.js`.
 *
 * Phase A.2 рефакторинг: вся реальная логика переехала в engine.
 * Этот файл существует чтобы IPC, enrich и setup-orchestrator
 * остались без изменений — они продолжают
 * `import * as dbService from './db-service.js'`.
 *
 * Singleton MysqlEngine инициализируется лениво при первом вызове
 * (избегаем циркулярных импортов на загрузке модуля). Каждый метод
 * шима — однострочный делегат.
 *
 * В Phase A.5 здесь появится мульти-engine routing: shim начнёт
 * выбирать конкретный engine из конфигурируемого списка по
 * project's databaseId. Пока — single hardcoded MySQL.
 *
 * @typedef {import('./db/types.js').DbEngine} DbEngine
 */

import { createMysqlEngine } from './db/mysql-engine.js'

/** @type {DbEngine | null} */
let _engine = null

function engine() {
  if (!_engine) _engine = createMysqlEngine()
  return _engine
}

export function testConnection() {
  return engine().testConnection()
}

export function listDatabases() {
  return engine().listDatabases()
}

export function getDatabaseSizes(names) {
  return engine().getDatabaseSizes(names)
}

export function createDatabase(name) {
  return engine().createDatabase(name)
}

export function dropDatabase(name) {
  return engine().dropDatabase(name)
}

export function restoreDatabase(name, dumpPath, jobKey, onProgress) {
  return engine().restoreDatabase(name, dumpPath, jobKey, onProgress)
}

export function isRestoring(jobKey) {
  return engine().isRestoring(jobKey)
}

export function cancelRestore(jobKey) {
  return engine().cancelRestore(jobKey)
}

export function killAllRestores() {
  return engine().killAllRestores()
}
