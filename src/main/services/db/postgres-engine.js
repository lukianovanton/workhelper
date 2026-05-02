/**
 * Реализация DbEngine для PostgreSQL.
 *
 * Подключение через node-postgres (`pg`). Restore — внешним CLI:
 *   - custom-format dump (начинается с магического префикса 'PGDMP')
 *     → pg_restore
 *   - plain SQL (всё остальное) → psql -f / psql < dump
 * Detect формата делается по первым байтам файла (gzip-сначала
 * тоже учитываем, расжимая на лету как в MysqlEngine).
 *
 * Имя БД нормализуется к lower_snake_case через тот же regex, что
 * у MysqlEngine — это согласованная конвенция приложения.
 *
 * @typedef {import('./types.js').DbEngine} DbEngine
 */

import { spawn } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { open, stat } from 'node:fs/promises'
import path from 'node:path'
import zlib from 'node:zlib'
import { Transform } from 'node:stream'
import pgPkg from 'pg'

const { Client } = pgPkg

const NAME_REGEX = /^[a-z0-9_]+$/

function assertDbName(name) {
  if (typeof name !== 'string' || !NAME_REGEX.test(name)) {
    throw new Error('Invalid database name: must match [a-z0-9_]+')
  }
}

/**
 * Magic-byte detection:
 *   - gzip:           0x1f 0x8b
 *   - pg_dump custom: ASCII "PGDMP" (50 47 44 4d 50)
 * Возвращает { isGzip, isCustomDump }. Один из/оба могут быть true
 * (gzip-обёрнутый custom dump). Если файл слишком короткий —
 * фолбэчимся на plain SQL.
 */
async function detectDumpFormat(filePath) {
  let fd
  try {
    fd = await open(filePath, 'r')
    const buf = Buffer.alloc(8)
    const { bytesRead } = await fd.read(buf, 0, 8, 0)
    if (bytesRead < 2) return { isGzip: false, isCustomDump: false }
    const isGzip = buf[0] === 0x1f && buf[1] === 0x8b
    let isCustomDump = false
    if (!isGzip && bytesRead >= 5) {
      isCustomDump =
        buf[0] === 0x50 && // P
        buf[1] === 0x47 && // G
        buf[2] === 0x44 && // D
        buf[3] === 0x4d && // M
        buf[4] === 0x50    // P
    }
    return { isGzip, isCustomDump }
  } catch {
    return { isGzip: false, isCustomDump: false }
  } finally {
    if (fd) await fd.close().catch(() => {})
  }
}

/**
 * @param {Object} opts
 * @param {() => string} opts.getHost
 * @param {() => number} opts.getPort
 * @param {() => string} opts.getUser
 * @param {() => string|null} opts.getPassword
 * @param {() => string} opts.getExecutable  абсолютный путь к psql/
 *                                            pg_restore (или папка bin
 *                                            где они лежат рядом).
 *                                            Если пусто — пробуем
 *                                            'psql'/'pg_restore' из PATH.
 * @returns {DbEngine}
 */
export function createPostgresEngine({
  getHost,
  getPort,
  getUser,
  getPassword,
  getExecutable
}) {
  /** @type {Map<string, {child:any, bytesRead:number, totalBytes:number, startedAt:number}>} */
  const restoreJobs = new Map()

  function buildClientConfig(database = 'postgres') {
    const host = getHost()
    const user = getUser()
    if (!host || !user) {
      throw new Error(
        'Postgres credentials not configured. Open Settings → Databases.'
      )
    }
    return {
      host,
      port: getPort() || 5432,
      user,
      password: getPassword() || '',
      database,
      // 5s connect-timeout — без этого pg может висеть до системного
      // TCP-таймаута, если хост недоступен.
      connectionTimeoutMillis: 5000
    }
  }

  /**
   * Подключение к 'postgres' БД (admin DB). CREATE/DROP DATABASE
   * нельзя выполнять в самой себе — нужен отдельный коннект.
   */
  async function withAdminClient(fn) {
    const client = new Client(buildClientConfig('postgres'))
    await client.connect()
    try {
      return await fn(client)
    } finally {
      await client.end().catch(() => {})
    }
  }

  /**
   * Резолвит путь к CLI-утилите. Если в Settings указан абсолютный
   * путь — пробуем именно его (поддерживаем как файл `psql.exe`, так
   * и директорию bin). Иначе фолбэчимся на 'psql'/'pg_restore'
   * из PATH.
   */
  function resolveCli(name) {
    const exec = (getExecutable() || '').trim()
    if (!exec) return name
    // Если указан конкретный путь к pg_restore.exe / psql.exe —
    // используем как есть для соответствующего бинаря, иначе
    // для другого подставляем basename'ом в той же директории.
    const lower = exec.toLowerCase()
    const wantPg = name === 'pg_restore'
    const wantPsql = name === 'psql'
    if (lower.endsWith('pg_restore.exe') || lower.endsWith('pg_restore')) {
      return wantPg ? exec : path.join(path.dirname(exec), name)
    }
    if (lower.endsWith('psql.exe') || lower.endsWith('psql')) {
      return wantPsql ? exec : path.join(path.dirname(exec), name)
    }
    // Похоже, дали bin-директорию.
    return path.join(exec, name)
  }

  async function testConnection() {
    const client = new Client(buildClientConfig('postgres'))
    try {
      await client.connect()
      const res = await client.query('SELECT version() AS v')
      const version = res.rows?.[0]?.v ? String(res.rows[0].v) : 'unknown'
      return { ok: true, version }
    } catch (e) {
      return {
        ok: false,
        message: e?.message || String(e),
        code: e?.code
      }
    } finally {
      await client.end().catch(() => {})
    }
  }

  async function listDatabases() {
    return withAdminClient(async (client) => {
      const res = await client.query(
        `SELECT datname FROM pg_database WHERE datistemplate = false`
      )
      const names = new Set()
      for (const row of res.rows) {
        if (typeof row.datname === 'string') {
          names.add(row.datname.toLowerCase())
        }
      }
      return names
    })
  }

  async function databaseExists(name) {
    if (typeof name !== 'string' || !name) return false
    return withAdminClient(async (client) => {
      const res = await client.query(
        `SELECT 1 FROM pg_database WHERE datname = $1 LIMIT 1`,
        [name.toLowerCase()]
      )
      return res.rowCount > 0
    })
  }

  async function getDatabaseSize(name) {
    if (typeof name !== 'string' || !name) return null
    return withAdminClient(async (client) => {
      try {
        const res = await client.query(
          `SELECT pg_database_size($1)::bigint AS bytes`,
          [name.toLowerCase()]
        )
        const bytes = res.rows?.[0]?.bytes
        return bytes != null ? Number(bytes) : null
      } catch (e) {
        // 3D000 invalid_catalog_name = БД не существует.
        if (e?.code === '3D000') return null
        throw e
      }
    })
  }

  async function getDatabaseSizes(names) {
    if (!names.length) return new Map()
    const sizes = new Map()
    return withAdminClient(async (client) => {
      // Один запрос с array param — сразу все размеры. Несуществующие
      // БД pg_database_size() трогать нельзя, поэтому JOIN с
      // pg_database по именам — сразу отфильтровывает их.
      const res = await client.query(
        `SELECT datname, pg_database_size(datname)::bigint AS bytes
           FROM pg_database
          WHERE datistemplate = false
            AND datname = ANY($1::text[])`,
        [names]
      )
      for (const row of res.rows) {
        sizes.set(String(row.datname).toLowerCase(), Number(row.bytes) || 0)
      }
      return sizes
    })
  }

  async function createDatabase(name) {
    assertDbName(name)
    return withAdminClient(async (client) => {
      try {
        await client.query(
          `CREATE DATABASE "${name}" ENCODING 'UTF8' TEMPLATE template0`
        )
      } catch (e) {
        // 42P04 duplicate_database
        if (e?.code === '42P04') {
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
    return withAdminClient(async (client) => {
      try {
        // Убиваем активные подключения, чтобы DROP не висел в
        // ожидании. WITH (FORCE) поддерживается с Postgres 13+.
        await client.query(
          `SELECT pg_terminate_backend(pid)
             FROM pg_stat_activity
            WHERE datname = $1 AND pid <> pg_backend_pid()`,
          [name]
        )
        await client.query(`DROP DATABASE "${name}"`)
      } catch (e) {
        // 3D000 invalid_catalog_name
        if (e?.code === '3D000') {
          throw new Error(`Database '${name}' does not exist`)
        }
        throw new Error(
          `Failed to drop database '${name}': ${e?.message || String(e)}`
        )
      }
    })
  }

  /**
   * Restore из дампа. Custom-format → pg_restore, plain SQL → psql.
   * Прогресс считаем по байтам исходного файла (как у MysqlEngine).
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

    const { isGzip, isCustomDump } = await detectDumpFormat(dumpPath)
    // Если файл gzip-завёрнут, внутри может быть и SQL, и pg-custom.
    // Для определения распакуем заголовок отдельно — но это сильно
    // усложняет код; на практике pg_dump custom редко жмут gzip
    // отдельно (формат сам по себе сжатый). Считаем: gzip → plain SQL.
    // Если у пользователя gzip+custom — будет ошибка от pg_restore с
    // понятным сообщением, и он сделает дамп без gzip.
    const usePgRestore = isCustomDump && !isGzip

    const existing = await listDatabases()
    if (!existing.has(name)) {
      throw new Error(
        `Database '${name}' does not exist. Create it first.`
      )
    }

    const password = getPassword() || ''
    const env = {
      ...process.env,
      PGPASSWORD: password,
      // Подавляем интерактивные prompts от psql/pg_restore — они нам
      // мешают в spawn'е и нужны были бы только для tty.
      PGCLIENTENCODING: 'UTF8'
    }

    let bin
    /** @type {string[]} */
    let args
    if (usePgRestore) {
      bin = resolveCli('pg_restore')
      args = [
        '-h', getHost(),
        '-p', String(getPort() || 5432),
        '-U', getUser(),
        '-d', name,
        '--no-owner',
        '--no-privileges'
      ]
    } else {
      bin = resolveCli('psql')
      args = [
        '-h', getHost(),
        '-p', String(getPort() || 5432),
        '-U', getUser(),
        '-d', name,
        '--single-transaction',
        '--set', 'ON_ERROR_STOP=1',
        '--quiet'
      ]
    }

    const child = spawn(bin, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      shell: false,
      env
    })

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
              `${path.basename(bin)} executable not found. Set the path in Settings → Databases (executable field).`
            )
          )
        } else {
          reject(new Error(`Failed to start ${path.basename(bin)}: ${err.message}`))
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
    if (isGzip) {
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
      throw new Error(`${path.basename(bin)} was terminated (${exitSignal})`)
    }
    if (exitCode !== 0) {
      let safeStderr = stderrBuf.slice(0, 500)
      if (password) safeStderr = safeStderr.split(password).join('<PWD>')
      throw new Error(
        `${path.basename(bin)} exited with code ${exitCode}: ${safeStderr.trim() || '<no stderr>'}`
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
    type: 'postgres',
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
