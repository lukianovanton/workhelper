import { ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { getConfig, setConfig } from '../services/config-store.js'
import {
  hasSecret,
  setSecret,
  clearSecret
} from '../services/secrets.js'
import {
  getProvider,
  invalidateProviders
} from '../services/vcs/registry.js'

/**
 * IPC для управления VCS-источниками (Phase A.4b).
 *
 *  - sources:list    список источников + has-token флаг (без секретов)
 *  - sources:add     добавить новый, генерим UUID, опционально с токеном
 *  - sources:update  патч одного по id
 *  - sources:remove  удалить по id + clear секрета + invalidate providers
 *  - sources:test    testConnection конкретного source
 *  - sources:setSecret  установить токен для source
 *  - sources:clearSecret очистить токен
 *
 * После любого изменения структуры sources вызываем
 * `invalidateProviders()` чтобы registry пересобрал инстансы при
 * следующем запросе.
 */
export function registerSourcesIpc() {
  ipcMain.handle('sources:list', () => {
    const sources = getConfig().sources || []
    return sources.map((s) => ({
      id: s.id,
      type: s.type,
      name: s.name,
      workspace: s.workspace || '',
      username: s.username || '',
      gitUsername: s.gitUsername || '',
      hasToken: hasSecret(`vcs:${s.id}:token`)
    }))
  })

  ipcMain.handle('sources:add', (_event, payload) => {
    if (!payload || typeof payload !== 'object') {
      throw new Error('Invalid source payload')
    }
    if (payload.type !== 'bitbucket') {
      throw new Error(`Unsupported source type: ${payload.type}`)
    }
    const id = payload.id || `bb-${randomUUID()}`
    const config = getConfig()
    const sources = Array.isArray(config.sources) ? [...config.sources] : []
    if (sources.some((s) => s.id === id)) {
      throw new Error(`Source with id ${id} already exists`)
    }
    sources.push({
      id,
      type: 'bitbucket',
      name: payload.name || payload.workspace || 'Bitbucket',
      workspace: payload.workspace || '',
      username: payload.username || '',
      gitUsername: payload.gitUsername || ''
    })
    setConfig({ sources })
    if (payload.token) {
      setSecret(`vcs:${id}:token`, payload.token)
    }
    invalidateProviders()
    return { id }
  })

  ipcMain.handle('sources:update', (_event, id, patch) => {
    if (!id) throw new Error('Source id is required')
    const config = getConfig()
    const sources = Array.isArray(config.sources) ? [...config.sources] : []
    const idx = sources.findIndex((s) => s.id === id)
    if (idx < 0) throw new Error(`Source ${id} not found`)
    const next = { ...sources[idx] }
    for (const key of ['name', 'workspace', 'username', 'gitUsername']) {
      if (patch && Object.prototype.hasOwnProperty.call(patch, key)) {
        next[key] = patch[key] ?? ''
      }
    }
    sources[idx] = next
    setConfig({ sources })
    invalidateProviders()
    return { ok: true }
  })

  ipcMain.handle('sources:remove', (_event, id) => {
    if (!id) throw new Error('Source id is required')
    const config = getConfig()
    const sources = (config.sources || []).filter((s) => s.id !== id)
    setConfig({ sources })
    const tokenKey = `vcs:${id}:token`
    if (hasSecret(tokenKey)) clearSecret(tokenKey)
    invalidateProviders()
    return { ok: true }
  })

  ipcMain.handle('sources:test', (_event, id) => {
    if (!id) throw new Error('Source id is required')
    const provider = getProvider(id)
    if (!provider) {
      return Promise.resolve({
        ok: false,
        stage: 'config',
        message: `Source ${id} not found.`
      })
    }
    return provider.testConnection()
  })

  ipcMain.handle('sources:setSecret', (_event, id, token) => {
    if (!id) throw new Error('Source id is required')
    if (!token || typeof token !== 'string') {
      throw new Error('Token must be a non-empty string')
    }
    setSecret(`vcs:${id}:token`, token)
    return { ok: true }
  })

  ipcMain.handle('sources:clearSecret', (_event, id) => {
    if (!id) throw new Error('Source id is required')
    const key = `vcs:${id}:token`
    if (hasSecret(key)) clearSecret(key)
    return { ok: true }
  })
}
