/**
 * MySQL-операции для enrich:
 *  - listDatabases  — SHOW DATABASES (одним вызовом для всех проектов)
 *  - sizes          — суммирует data_length+index_length из information_schema
 *  - testConnection — простой ping для Settings → Database → Test
 *
 * Подключение per-call: создаём connection, делаем 1-2 query, закрываем.
 * Для enrich это 1 connection на refresh — приемлемо, пул не нужен.
 *
 * Креды собираются из config-store + secrets. Если креды не настроены —
 * каждая функция бросает с понятным сообщением; enrich-оркестратор
 * ловит и просто пропускает БД-данные (db.exists остаётся false).
 */

import mysql from 'mysql2/promise'
import { spawn } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import zlib from 'node:zlib'
import { Transform } from 'node:stream'
import { getConfig } from './config-store.js'
import { getSecret } from './secrets.js'

function buildConnectionConfig() {
  const { database } = getConfig()
  if (!database.host || !database.user) {
    throw new Error(
      'MySQL credentials not configured. Open Settings → Database.'
    )
  }
  const password = getSecret('dbPassword') || ''
  return {
    host: database.host,
    port: database.port || 3306,
    user: database.user,
    password,
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

/**
 * @returns {Promise<Set<string>>} имена БД в нижнем регистре
 */
export async function listDatabases() {
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

/**
 * Суммарный размер (data + index) для всех БД из списка.
 * Один запрос с IN (...) — быстрее, чем по одной БД.
 *
 * @param {string[]} names — имена БД (lowercased)
 * @returns {Promise<Map<string, number>>} имя → байты
 */
export async function getDatabaseSizes(names) {
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
 * CREATE DATABASE с utf8mb4 и unicode collation.
 * Если БД существует — переписываем 1007 в человеческое сообщение.
 *
 * @param {string} name
 */
export async function createDatabase(name) {
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

/**
 * DROP DATABASE — необратимо. Валидация имени так же строга.
 * 1008 (does-not-exist) переписывается в понятное сообщение.
 *
 * @param {string} name
 */
export async function dropDatabase(name) {
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
 * Путь к mysql CLI: явный из Settings или fallback 'mysql' (PATH).
 */
export function mysqlExecutablePath() {
  const exec = getConfig().database.mysqlExecutable
  if (exec && exec.trim()) return exec.trim()
  return 'mysql'
}

/**
 * In-memory карта активных restore'ов: slug → { child, bytesRead, totalBytes, startedAt }.
 * Используется для kill-on-quit и для блокировки повторного restore того же slug.
 */
const restoreJobs = new Map()

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
 *
 * @param {string} name      имя БД
 * @param {string} dumpPath
 * @param {string} jobKey    обычно slug — ключ для restoreJobs/cancel
 * @param {(p:{bytesRead:number,totalBytes:number})=>void} [onProgress]
 */
export async function restoreDatabase(name, dumpPath, jobKey, onProgress) {
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

  const lower = dumpPath.toLowerCase()
  const isGz = lower.endsWith('.sql.gz') || lower.endsWith('.gz')
  const isSql = lower.endsWith('.sql')
  if (!isGz && !isSql) {
    throw new Error('Only .sql or .sql.gz dumps are supported')
  }

  // БД должна уже существовать — Setup & Run (ч10) сам сделает Create
  // перед Restore; standalone Restore требует наличия БД
  const existing = await listDatabases()
  if (!existing.has(name)) {
    throw new Error(
      `Database '${name}' does not exist. Create it first.`
    )
  }

  const config = getConfig()
  const password = getSecret('dbPassword') || ''
  const args = [
    '-h', config.database.host,
    '-P', String(config.database.port || 3306),
    '-u', config.database.user,
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
    // Ограничим, чтобы не съесть память на гигантском дампе
    if (stderrBuf.length > 10_000) stderrBuf = stderrBuf.slice(-5000)
  })

  const fileStream = createReadStream(dumpPath)
  if (isGz) {
    fileStream.pipe(tap).pipe(zlib.createGunzip()).pipe(child.stdin)
  } else {
    fileStream.pipe(tap).pipe(child.stdin)
  }

  // Ждём mysql exit; ошибки file-stream форсируют kill
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

  // Финальный 100% — на случай если последний tap-тик был throttled
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

/**
 * @returns {boolean}
 */
export function isRestoring(jobKey) {
  return restoreJobs.has(jobKey)
}

/**
 * Гасит все живые mysql-процессы restore'а — вызывается из before-quit.
 */
export function killAllRestores() {
  for (const [, h] of restoreJobs) {
    try {
      h.child.kill('SIGTERM')
    } catch {
      // ignore
    }
  }
  restoreJobs.clear()
}

/**
 * Проверка коннекта для Settings → Database → Test.
 * @returns {Promise<{ok:true,version:string}|{ok:false,message:string,code?:string}>}
 */
export async function testConnection() {
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
