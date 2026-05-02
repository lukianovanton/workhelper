/**
 * Тонкий shim над DB-registry.
 *
 * Phase A.5a: реальная маршрутизация переехала в `db/registry.js`.
 * Этот файл остаётся как back-compat-точка для IPC, enrich и
 * setup-orchestrator: они продолжают
 * `import * as dbService from './db-service.js'`.
 *
 * Все вызовы делегируются в default engine (первый сконфигурированный).
 * В A.5b/A.6 появятся per-project engine resolvers и часть методов
 * начнёт принимать engineId явно.
 *
 * @typedef {import('./db/types.js').DbEngine} DbEngine
 */

import {
  getDefaultEngine,
  getEngineForProject
} from './db/registry.js'

function defaultEngineOrThrow() {
  const eng = getDefaultEngine()
  if (!eng) {
    throw new Error(
      'No database engine configured. Open Settings → Databases.'
    )
  }
  return eng
}

export function testConnection() {
  const eng = getDefaultEngine()
  if (!eng) {
    return Promise.resolve({
      ok: false,
      message: 'No database engine configured.'
    })
  }
  return eng.testConnection()
}

export function listDatabases() {
  return defaultEngineOrThrow().listDatabases()
}

export function getDatabaseSizes(names) {
  return defaultEngineOrThrow().getDatabaseSizes(names)
}

export function createDatabase(name) {
  return defaultEngineOrThrow().createDatabase(name)
}

export function dropDatabase(name) {
  return defaultEngineOrThrow().dropDatabase(name)
}

/**
 * Restore идёт через engine, привязанный к slug проекта (на момент
 * A.5a — всегда default, см. getEngineForProject).
 */
export function restoreDatabase(name, dumpPath, jobKey, onProgress) {
  const eng = getEngineForProject(jobKey) || getDefaultEngine()
  if (!eng) {
    return Promise.reject(
      new Error('No database engine configured for restore.')
    )
  }
  return eng.restoreDatabase(name, dumpPath, jobKey, onProgress)
}

export function isRestoring(jobKey) {
  const eng = getEngineForProject(jobKey) || getDefaultEngine()
  return eng ? eng.isRestoring(jobKey) : false
}

export function cancelRestore(jobKey) {
  const eng = getEngineForProject(jobKey) || getDefaultEngine()
  return eng ? eng.cancelRestore(jobKey) : false
}

export function killAllRestores() {
  const eng = getDefaultEngine()
  if (eng) eng.killAllRestores()
}
