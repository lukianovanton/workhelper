/**
 * Контракт DbEngine — единый интерфейс движков БД, через который
 * приложение делает enrich (exists/size), destructive operations
 * (create/drop) и restore из дампа. На момент Phase A.2 единственный
 * реализатор — MysqlEngine; в Phase C добавится PostgresEngine.
 *
 * Все async-методы бросают `Error` с человеческим `message`. Имена
 * БД нормализуются engine'ом (lowercased для MySQL — у Postgres та же
 * конвенция применима, but не строго требуется).
 *
 * Прогресс restore'а — callback `onProgress({bytesRead, totalBytes})`,
 * throttle ≥200мс делает сам engine. Job-state (`isRestoring`,
 * `cancelRestore`, `killAllRestores`) держится отдельной картой
 * на инстанс — каждый engine знает только про свои активные restore'ы.
 */

/**
 * @typedef {{ ok: true, version: string } |
 *          { ok: false, message: string, code?: string }
 *         } DbTestResult
 */

/**
 * @typedef {Object} RestoreProgress
 * @property {number} bytesRead    байты файла дампа уже стрименые в engine
 * @property {number} totalBytes   stat'нутый size файла
 */

/**
 * @typedef {Object} RestoreResult
 * @property {number} bytesRead
 * @property {number} totalBytes
 * @property {number} durationMs
 * @property {string} dumpFile
 */

/**
 * @typedef {Object} DbEngine
 * @property {string} type
 *   стабильный идентификатор реализации ('mysql', 'postgres').
 *
 * @property {() => Promise<DbTestResult>} testConnection
 *   Простой ping вида SELECT VERSION() / SELECT 1.
 *
 * @property {() => Promise<Set<string>>} listDatabases
 *   Все user-БД (исключая system). Имена в нижнем регистре.
 *
 * @property {(name: string) => Promise<boolean>} databaseExists
 *   Удобная обёртка над listDatabases для одиночных проверок.
 *
 * @property {(name: string) => Promise<number|null>} getDatabaseSize
 *   Размер одной БД в байтах. null если БД не существует.
 *
 * @property {(names: string[]) => Promise<Map<string, number>>} getDatabaseSizes
 *   Батч-вариант (для enrich): один SQL-запрос для N БД. Имена БД
 *   которые не существуют — отсутствуют в результирующей Map.
 *
 * @property {(name: string) => Promise<void>} createDatabase
 *   CREATE DATABASE с разумными defaults (utf8mb4 для MySQL,
 *   UTF8 + en_US.UTF-8 для Postgres).
 *
 * @property {(name: string) => Promise<void>} dropDatabase
 *
 * @property {(
 *   name: string,
 *   dumpPath: string,
 *   jobKey: string,
 *   onProgress?: (p: RestoreProgress) => void
 * ) => Promise<RestoreResult>} restoreDatabase
 *   Стримящий restore из .sql/.sql.gz/.dump. Engine сам определяет
 *   формат дампа и выбирает CLI (mysql, psql, pg_restore).
 *   jobKey — обычно slug проекта; используется для isRestoring/
 *   cancelRestore.
 *
 * @property {(jobKey: string) => boolean} isRestoring
 *
 * @property {(jobKey: string) => boolean} cancelRestore
 *   Прерывает один активный restore (SIGTERM child'у).
 *
 * @property {() => void} killAllRestores
 *   Гасит все живые restore-процессы (на before-quit).
 */

export {}
