/**
 * Реализация DbEngine для MySQL. Логика перенесена как есть из
 * db-service.js — никакого изменения поведения, только переход к
 * engine-форме (factory + per-instance restoreJobs Map вместо
 * модульной).
 *
 * Креды читаются из global config-store при каждом вызове через
 * `buildConnectionConfig()` — это сохраняет поведение оригинала:
 * после изменения настроек в Settings следующий вызов уже видит
 * новые значения.
 *
 * @typedef {import('./types.js').DbEngine} DbEngine
 * @typedef {import('./types.js').RestoreProgress} RestoreProgress
 */

import mysql from 'mysql2/promise'
import { spawn } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { open, stat } from 'node:fs/promises'
import path from 'node:path'
import zlib from 'node:zlib'
import { Transform } from 'node:stream'

/**
 * Имя БД должно быть строго [a-z0-9_]+ — это та же конвенция что в
 * enrich (slug.toLowerCase()) и плюс защита от SQL-инъекций сверх
 * backtick-quoting в самом запросе.
 */
const NAME_REGEX = /^[a-z0-9_]+$/

function assertDbName(name) {
  if (typeof name !== 'string' || !NAME_REGEX.test(name)) {
    throw new Error('Invalid database name: must match [a-z0-9_]+')
  }
}

/**
 * Проверка gzip-формата по магическим байтам (0x1f 0x8b).
 */
async function isGzipFile(filePath) {
  let fd
  try {
    fd = await open(filePath, 'r')
    const buf = Buffer.alloc(2)
    const { bytesRead } = await fd.read(buf, 0, 2, 0)
    if (bytesRead < 2) return false
    return buf[0] === 0x1f && buf[1] === 0x8b
  } catch {
    return false
  } finally {
    if (fd) await fd.close().catch(() => {})
  }
}

/**
 * Фабрика MysqlEngine.
 *
 * Phase A.5a: фабрика принимает явные lazy-getters вместо чтения
 * глобального config-store / secrets. Это позволяет создавать
 * несколько инстансов под разные DB-connection'ы (Phase A.5b даст
 * это через UI).
 *
 * Каждый инстанс держит собственную карту активных restore'ов
 * (`restoreJobs: Map<jobKey, handle>`).
 *
 * @param {Object} opts
 * @param {() => string} opts.getHost
 * @param {() => number} opts.getPort
 * @param {() => string} opts.getUser
 * @param {() => string|null} opts.getPassword
 * @param {() => string} opts.getExecutable  абсолютный путь к mysql CLI
 *                                            (или 'mysql' для PATH)
 * @returns {DbEngine}
 */
export function createMysqlEngine({
  getHost,
  getPort,
  getUser,
  getPassword,
  getExecutable
}) {
  /** @type {Map<string, {child:any, bytesRead:number, totalBytes:number, startedAt:number}>} */
  const restoreJobs = new Map()

  function buildConnectionConfig() {
    const host = getHost()
    const user = getUser()
    if (!host || !user) {
      throw new Error(
        'MySQL credentials not configured. Open Settings → Databases.'
      )
    }
    return {
      host,
      port: getPort() || 3306,
      user,
      password: getPassword() || '',
      connectTimeout: 5000
    }
  }

  async function withConnection(fn) {
    const conn = await mysql.createConnection(buildConnectionConfig())
    try {
      return await fn(conn)
    } finally {
      await conn.end().catch(() => {})
    }
  }

  function mysqlExecutablePath() {
    const exec = getExecutable()
    if (exec && exec.trim()) return exec.trim()
    return 'mysql'
  }

  async function testConnection() {
    try {
      return await withConnection(async (conn) => {
        const [rows] = await conn.query('SELECT VERSION() AS v')
        const version = rows?.[0]?.v ? String(rows[0].v) : 'unknown'
        return { ok: true, version }
      })
    } catch (e) {
      return {
        ok: false,
        message: e?.message || String(e),
        code: e?.code
      }
    }
  }

  async function listDatabases() {
    return withConnection(async (conn) => {
      const [rows] = await conn.query('SHOW DATABASES')
      const names = new Set()
      for (const row of rows) {
        const name = row.Database || row.database
        if (typeof name === 'string') names.add(name.toLowerCase())
      }
      return names
    })
  }

  async function databaseExists(name) {
    if (typeof name !== 'string' || !name) return false
    const set = await listDatabases()
    return set.has(name.toLowerCase())
  }

  async function getDatabaseSizes(names) {
    if (!names.length) return new Map()
    return withConnection(async (conn) => {
      const [rows] = await conn.query(
        `SELECT table_schema AS name,
                COALESCE(SUM(data_length + index_length), 0) AS bytes
           FROM information_schema.tables
          WHERE table_schema IN (?)
          GROUP BY table_schema`,
        [names]
      )
      const sizes = new Map()
      for (const row of rows) {
        sizes.set(String(row.name).toLowerCase(), Number(row.bytes) || 0)
      }
      return sizes
    })
  }

  async function getDatabaseSize(name) {
    if (typeof name !== 'string' || !name) return null
    const sizes = await getDatabaseSizes([name.toLowerCase()])
    return sizes.get(name.toLowerCase()) ?? null
  }

  async function createDatabase(name) {
    assertDbName(name)
    return withConnection(async (conn) => {
      try {
        await conn.query(
          `CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
        )
      } catch (e) {
        if (e?.errno === 1007) {
          throw new Error(`Database '${name}' already exists`)
        }
        throw new Error(
          `Failed to create database '${name}': ${e?.message || String(e)}`
        )
      }
    })
  }

  async function dropDatabase(name) {
    assertDbName(name)
    return withConnection(async (conn) => {
      try {
        await conn.query(`DROP DATABASE \`${name}\``)
      } catch (e) {
        if (e?.errno === 1008) {
          throw new Error(`Database '${name}' does not exist`)
        }
        throw new Error(
          `Failed to drop database '${name}': ${e?.message || String(e)}`
        )
      }
    })
  }

  /**
   * Восстановление БД из .sql или .sql.gz дампа.
   *
   *  - Валидирует имя (тот же regex), проверяет, что БД существует
   *  - Spawn'ит mysql CLI с stdin pipe; контент дампа течёт
   *    file → progress-tap → [gunzip?] → mysql.stdin
   *  - bytesRead считаем ДО декомпрессии (по байтам файла), totalBytes
   *    = stat(dumpPath).size — даёт честный 0..100% по I/O
   *  - onProgress зовётся в throttled-режиме (≥200мс между вызовами +
   *    финальный «100%» в конце)
   *  - Stderr mysql собираем в кольцо до 5к; на non-zero exit отдаём
   *    первые 500 символов в Error
   */
  async function restoreDatabase(name, dumpPath, jobKey, onProgress) {
    assertDbName(name)

    if (!dumpPath || typeof dumpPath !== 'string') {
      throw new Error('Dump path is required')
    }
    if (restoreJobs.has(jobKey)) {
      throw new Error(`Restore already in progress for ${jobKey}`)
    }

    const stats = await stat(dumpPath).catch(() => null)
    if (!stats || !stats.isFile()) {
      throw new Error(`Dump file not found: ${dumpPath}`)
    }
    if (stats.size === 0) {
      throw new Error(`Dump file is empty: ${dumpPath}`)
    }

    // Формат определяется по содержимому, а не по расширению — у нас
    // ходят файлы вида `dump-P0070-2026-04-01` без расширения. Gzip
    // имеет фиксированный magic-prefix 0x1f 0x8b.
    const isGz = await isGzipFile(dumpPath)

    // БД должна уже существовать — Setup & Run сам сделает Create
    // перед Restore; standalone Restore требует наличия БД.
    const existing = await listDatabases()
    if (!existing.has(name)) {
      throw new Error(
        `Database '${name}' does not exist. Create it first.`
      )
    }

    const password = getPassword() || ''
    const args = [
      '-h', getHost(),
      '-P', String(getPort() || 3306),
      '-u', getUser(),
      `--password=${password}`,
      '--default-character-set=utf8mb4',
      name
    ]

    const mysqlBin = mysqlExecutablePath()

    const child = spawn(mysqlBin, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      shell: false
    })

    // Дождаться spawn / error — даёт сразу человеческое ENOENT
    await new Promise((resolve, reject) => {
      const onSpawn = () => {
        child.removeListener('error', onError)
        resolve()
      }
      const onError = (err) => {
        child.removeListener('spawn', onSpawn)
        if (err && err.code === 'ENOENT') {
          reject(
            new Error(
              'mysql executable not found. Set path in Settings → Database → mysql executable.'
            )
          )
        } else {
          reject(new Error(`Failed to start mysql: ${err.message}`))
        }
      }
      child.once('spawn', onSpawn)
      child.once('error', onError)
    })

    const handle = {
      child,
      bytesRead: 0,
      totalBytes: stats.size,
      startedAt: Date.now()
    }
    restoreJobs.set(jobKey, handle)

    // Прогресс-tap считает байты, throttle ≥200мс
    let lastEmit = 0
    const tap = new Transform({
      transform(chunk, _enc, cb) {
        handle.bytesRead += chunk.length
        const now = Date.now()
        if (now - lastEmit >= 200) {
          lastEmit = now
          onProgress?.({
            bytesRead: handle.bytesRead,
            totalBytes: handle.totalBytes
          })
        }
        cb(null, chunk)
      }
    })

    let stderrBuf = ''
    child.stderr.on('data', (d) => {
      stderrBuf += d.toString()
      if (stderrBuf.length > 10_000) stderrBuf = stderrBuf.slice(-5000)
    })

    const fileStream = createReadStream(dumpPath)
    if (isGz) {
      fileStream.pipe(tap).pipe(zlib.createGunzip()).pipe(child.stdin)
    } else {
      fileStream.pipe(tap).pipe(child.stdin)
    }

    let exitCode = -1
    let exitSignal = null
    let fileError = null
    try {
      exitCode = await new Promise((resolve, reject) => {
        child.once('exit', (code, signal) => {
          exitSignal = signal
          resolve(code)
        })
        child.once('error', reject)
        fileStream.once('error', (err) => {
          fileError = err
          try {
            child.kill()
          } catch {
            // ignore
          }
          reject(err)
        })
      })
    } finally {
      restoreJobs.delete(jobKey)
    }

    if (fileError) {
      throw new Error(`Failed to read dump: ${fileError.message}`)
    }
    if (exitSignal) {
      throw new Error(`mysql was terminated (${exitSignal})`)
    }
    if (exitCode !== 0) {
      let safeStderr = stderrBuf.slice(0, 500)
      if (password) safeStderr = safeStderr.split(password).join('<PWD>')
      throw new Error(
        `mysql exited with code ${exitCode}: ${safeStderr.trim() || '<no stderr>'}`
      )
    }

    onProgress?.({
      bytesRead: handle.totalBytes,
      totalBytes: handle.totalBytes
    })

    return {
      bytesRead: handle.totalBytes,
      totalBytes: handle.totalBytes,
      durationMs: Date.now() - handle.startedAt,
      dumpFile: path.basename(dumpPath)
    }
  }

  function isRestoring(jobKey) {
    return restoreJobs.has(jobKey)
  }

  function cancelRestore(jobKey) {
    const handle = restoreJobs.get(jobKey)
    if (!handle) return false
    try {
      handle.child.kill('SIGTERM')
      return true
    } catch {
      return false
    }
  }

  function killAllRestores() {
    for (const [, h] of restoreJobs) {
      try {
        h.child.kill('SIGTERM')
      } catch {
        // ignore
      }
    }
    restoreJobs.clear()
  }

  return {
    type: 'mysql',
    testConnection,
    listDatabases,
    databaseExists,
    getDatabaseSize,
    getDatabaseSizes,
    createDatabase,
    dropDatabase,
    restoreDatabase,
    isRestoring,
    cancelRestore,
    killAllRestores
  }
}
