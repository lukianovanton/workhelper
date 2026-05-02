/**
 * Хранение секретов через Electron safeStorage.
 *
 * - Шифрование платформенным API (DPAPI на Windows)
 * - Зашифрованный blob (base64) лежит в отдельном electron-store файле
 *   `app.getPath('userData')/secrets.json` — не пересекается с основным
 *   config.json, чтобы случайно не утекло в логи / экспорт настроек
 * - safeStorage.isEncryptionAvailable() требует, чтобы app был ready;
 *   IPC-хендлеры вызываются после whenReady так что условие всегда выполнено
 *
 * Поддерживаемые ключи:
 *   - 'dbPassword'           — пароль MySQL
 *   - 'jiraApiToken'         — Jira API token
 *   - 'bitbucketApiToken'    — DEPRECATED, остаётся для миграции к
 *                               per-source ключам (Phase A.4b).
 *                               См. migrateLegacyBitbucketToken().
 *   - 'vcs:<source-id>:token' — API token для VCS-источника по id;
 *                               динамическая форма ключа, валидируется
 *                               regex'ом.
 */

import { safeStorage } from 'electron'
import Store from 'electron-store'
import { DEFAULT_BB_SOURCE_ID } from './config-store.js'

const store = new Store({
  name: 'secrets',
  clearInvalidConfig: true
})

const STATIC_KEYS = new Set([
  'bitbucketApiToken', // legacy, ещё читаем
  'dbPassword',
  'jiraApiToken'
])

const VCS_KEY_REGEX = /^vcs:[a-zA-Z0-9_-]+:token$/

function assertKey(key) {
  if (typeof key !== 'string') {
    throw new Error('Secret key must be a string')
  }
  if (STATIC_KEYS.has(key)) return
  if (VCS_KEY_REGEX.test(key)) return
  throw new Error(`Unknown secret key: ${key}`)
}

/**
 * @param {string} key
 * @param {string} value
 */
export function setSecret(key, value) {
  assertKey(key)
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      'safeStorage encryption is not available on this system. ' +
        'On Windows this typically means DPAPI is disabled.'
    )
  }
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('Secret value must be a non-empty string')
  }
  const encrypted = safeStorage.encryptString(value)
  store.set(key, encrypted.toString('base64'))
}

/**
 * @param {string} key
 * @returns {string|null}
 */
export function getSecret(key) {
  assertKey(key)
  const stored = store.get(key)
  if (!stored || typeof stored !== 'string') return null
  try {
    return safeStorage.decryptString(Buffer.from(stored, 'base64'))
  } catch {
    // Если ключ DPAPI сменился (миграция OS / новый профиль) —
    // расшифровать невозможно, удаляем мёртвый blob.
    store.delete(key)
    return null
  }
}

/**
 * @param {string} key
 */
export function clearSecret(key) {
  assertKey(key)
  store.delete(key)
}

/**
 * Карта статических ключей → boolean (есть ли значение). Не раскрывает
 * значения. VCS-токены отдельно: для них есть `hasSecret(key)` и UI
 * запрашивает их per-source.
 *
 * @returns {{ bitbucketApiToken: boolean, dbPassword: boolean, jiraApiToken: boolean }}
 */
export function secretsStatus() {
  return {
    bitbucketApiToken: store.has('bitbucketApiToken'),
    dbPassword: store.has('dbPassword'),
    jiraApiToken: store.has('jiraApiToken')
  }
}

/**
 * Точечная проверка наличия любого валидного ключа (включая
 * динамические vcs:*:token).
 *
 * @param {string} key
 * @returns {boolean}
 */
export function hasSecret(key) {
  assertKey(key)
  return store.has(key)
}

/**
 * Миграция legacy `bitbucketApiToken` → `vcs:bitbucket-default:token`.
 * Вызывать один раз на старте приложения после whenReady (safeStorage
 * требует ready-app).
 *
 * Идемпотентно: если новый ключ уже существует — не трогает legacy
 * (пользователь мог явно сбросить новый ключ; не воскрешаем его).
 * Если успешно скопировали — стираем legacy.
 */
export function migrateLegacyBitbucketToken() {
  const legacyKey = 'bitbucketApiToken'
  const newKey = `vcs:${DEFAULT_BB_SOURCE_ID}:token`
  if (!store.has(legacyKey)) return
  if (store.has(newKey)) return

  const legacyValue = getSecret(legacyKey)
  if (!legacyValue) {
    // blob испорчен — getSecret уже его удалил.
    return
  }
  setSecret(newKey, legacyValue)
  clearSecret(legacyKey)
}
