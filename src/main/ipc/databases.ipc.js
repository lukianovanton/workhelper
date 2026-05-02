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
  invalidateEngines
} from '../services/db/registry.js'

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
    if (payload.type !== 'mysql' && payload.type !== 'postgres') {
      throw new Error(`Unsupported database type: ${payload.type}`)
    }
    const isPostgres = payload.type === 'postgres'
    const defaultPort = isPostgres ? 5432 : 3306
    const defaultUser = isPostgres ? 'postgres' : 'root'
    const fallbackName = isPostgres ? 'PostgreSQL' : 'MySQL'
    const id =
      payload.id ||
      `${payload.type}-${randomUUID()}`
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
          ? `${payload.user || defaultUser}@${payload.host}`
          : fallbackName),
      host: payload.host || 'localhost',
      port: payload.port || defaultPort,
      user: payload.user || defaultUser,
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
}
