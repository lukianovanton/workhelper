import { ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { getConfig, setConfig } from '../services/config-store.js'
import {
  hasSecret,
  setSecret,
  clearSecret
} from '../services/secrets.js'
import {
  getEngine,
  invalidateEngines,
  listDatabaseConfigs
} from '../services/db/registry.js'
import {
  getDbEngineDef,
  isSupportedDbType
} from '../services/db/engines.js'
import * as fsService from '../services/fs-service.js'

/**
 * IPC для управления DB-подключениями (Phase A.5b).
 *
 *  - databases:list        список подключений + has-password флаг
 *  - databases:add         добавить новое (UUID, опционально с паролем)
 *  - databases:update      патч одного по id
 *  - databases:remove      удалить + clear секрета + invalidate engines
 *  - databases:test        testConnection конкретного engine
 *  - databases:setSecret   установить пароль
 *  - databases:clearSecret очистить пароль
 */
export function registerDatabasesIpc() {
  ipcMain.handle('databases:list', () => {
    const dbs = getConfig().databases || []
    return dbs.map((d) => ({
      id: d.id,
      type: d.type,
      name: d.name,
      host: d.host || '',
      port: d.port || 0,
      user: d.user || '',
      executable: d.executable || '',
      hasPassword: hasSecret(`db:${d.id}:password`)
    }))
  })

  ipcMain.handle('databases:add', (_event, payload) => {
    if (!payload || typeof payload !== 'object') {
      throw new Error('Invalid database payload')
    }
    if (!isSupportedDbType(payload.type)) {
      throw new Error(`Unsupported database type: ${payload.type}`)
    }
    const def = getDbEngineDef(payload.type)
    const id = payload.id || `${payload.type}-${randomUUID()}`
    const config = getConfig()
    const databases = Array.isArray(config.databases)
      ? [...config.databases]
      : []
    if (databases.some((d) => d.id === id)) {
      throw new Error(`Database with id ${id} already exists`)
    }
    databases.push({
      id,
      type: payload.type,
      name:
        payload.name ||
        (payload.host
          ? `${payload.user || def.defaultUser}@${payload.host}`
          : def.fallbackName),
      host: payload.host || 'localhost',
      port: payload.port || def.defaultPort,
      user: payload.user || def.defaultUser,
      executable: payload.executable || ''
    })
    setConfig({ databases })
    if (payload.password) {
      setSecret(`db:${id}:password`, payload.password)
    }
    invalidateEngines()
    return { id }
  })

  ipcMain.handle('databases:update', (_event, id, patch) => {
    if (!id) throw new Error('Database id is required')
    const config = getConfig()
    const databases = Array.isArray(config.databases)
      ? [...config.databases]
      : []
    const idx = databases.findIndex((d) => d.id === id)
    if (idx < 0) throw new Error(`Database ${id} not found`)
    const next = { ...databases[idx] }
    for (const key of [
      'name',
      'host',
      'port',
      'user',
      'executable'
    ]) {
      if (patch && Object.prototype.hasOwnProperty.call(patch, key)) {
        next[key] = patch[key] ?? (key === 'port' ? 0 : '')
      }
    }
    databases[idx] = next
    setConfig({ databases })
    invalidateEngines()
    return { ok: true }
  })

  ipcMain.handle('databases:remove', (_event, id) => {
    if (!id) throw new Error('Database id is required')
    const config = getConfig()
    const databases = (config.databases || []).filter((d) => d.id !== id)
    setConfig({ databases })
    const key = `db:${id}:password`
    if (hasSecret(key)) clearSecret(key)
    invalidateEngines()
    return { ok: true }
  })

  ipcMain.handle('databases:test', (_event, id) => {
    if (!id) throw new Error('Database id is required')
    const engine = getEngine(id)
    if (!engine) {
      return Promise.resolve({
        ok: false,
        message: `Database ${id} not found.`
      })
    }
    return engine.testConnection()
  })

  ipcMain.handle('databases:setSecret', (_event, id, password) => {
    if (!id) throw new Error('Database id is required')
    if (!password || typeof password !== 'string') {
      throw new Error('Password must be a non-empty string')
    }
    setSecret(`db:${id}:password`, password)
    return { ok: true }
  })

  ipcMain.handle('databases:clearSecret', (_event, id) => {
    if (!id) throw new Error('Database id is required')
    const key = `db:${id}:password`
    if (hasSecret(key)) clearSecret(key)
    return { ok: true }
  })

  // Список всех БД на конкретном engine (для combobox в drawer'е).
  // Возвращает имена в нижнем регистре, как listDatabases().
  ipcMain.handle('databases:listDbNames', async (_event, id) => {
    if (!id) return []
    const engine = getEngine(id)
    if (!engine) return []
    try {
      const set = await engine.listDatabases()
      return Array.from(set).sort()
    } catch {
      return []
    }
  })

  // Авто-детект подходящего DB-подключения для проекта.
  //
  // Логика приоритетов (best → worst):
  //   1. exact name match на любом engine        → confidence='exact'
  //   2. fuzzy name match на engine типа,
  //      совпадающего с детектом стека            → confidence='fuzzy'
  //   3. fuzzy name match на любом engine        → confidence='fuzzy'
  //   4. engine-only: stack-detect нашёл тип
  //      (Postgres/MySQL по сигналам в коде),
  //      но имя БД не угадали → возвращаем
  //      первое подключение этого типа           → confidence='engine-only'
  //
  // (4) — именно для случая «slug AffiliateCRM, БД на постгресе называется
  // qacrm»: имя не fuzzy-матчится со slug'ом, но в коде .csproj есть
  // Npgsql → подсветим Postgres-подключение, юзер дальше выберет имя
  // из dropdown'а сам.
  ipcMain.handle('databases:detectForProject', async (_event, slug) => {
    if (!slug || typeof slug !== 'string') return null
    const target = slug.toLowerCase()
    const dbs = listDatabaseConfigs()

    // Stack-engine — best-effort. Если проект не клонирован или detect
    // не дал результата, просто null'ом.
    let stackEngineType = null
    try {
      const projectsRoot = getConfig().paths?.projectsRoot
      if (projectsRoot && fsService.projectExists(projectsRoot, slug)) {
        const detected = await fsService.detectStack(
          fsService.projectPath(projectsRoot, slug)
        )
        stackEngineType = detected?.databaseEngine || null
      }
    } catch {
      // ignore — детект не critical path
    }

    let fuzzyOnSameType = null
    let fuzzyAny = null
    let firstOfDetectedType = null

    for (const d of dbs) {
      const engine = getEngine(d.id)
      if (!engine) continue
      const isSameType = stackEngineType && d.type === stackEngineType
      if (isSameType && !firstOfDetectedType) {
        firstOfDetectedType = { databaseId: d.id, dbType: d.type }
      }
      let names
      try {
        names = await engine.listDatabases()
      } catch {
        continue
      }
      if (names.has(target)) {
        return {
          databaseId: d.id,
          dbName: target,
          confidence: 'exact'
        }
      }
      const fuzzy = [...names].find(
        (n) => n.includes(target) || target.includes(n)
      )
      if (fuzzy) {
        const candidate = {
          databaseId: d.id,
          dbName: fuzzy,
          confidence: 'fuzzy'
        }
        if (isSameType && !fuzzyOnSameType) fuzzyOnSameType = candidate
        if (!fuzzyAny) fuzzyAny = candidate
      }
    }
    if (fuzzyOnSameType) return fuzzyOnSameType
    if (fuzzyAny) return fuzzyAny
    if (firstOfDetectedType) {
      return {
        databaseId: firstOfDetectedType.databaseId,
        dbName: '',
        confidence: 'engine-only'
      }
    }
    return null
  })
}
