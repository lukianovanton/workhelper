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
