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
 * Поддерживаемые ключи: 'bitbucketApiToken', 'dbPassword'.
 */

import { safeStorage } from 'electron'
import Store from 'electron-store'

const store = new Store({
  name: 'secrets',
  clearInvalidConfig: true
})

const VALID_KEYS = new Set(['bitbucketApiToken', 'dbPassword'])

function assertKey(key) {
  if (!VALID_KEYS.has(key)) {
    throw new Error(`Unknown secret key: ${key}`)
  }
}

/**
 * @param {'bitbucketApiToken'|'dbPassword'} key
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
 * @param {'bitbucketApiToken'|'dbPassword'} key
 * @returns {string|null}
 */
export function getSecret(key) {
  assertKey(key)
  const stored = store.get(key)
  if (!stored || typeof stored !== 'string') return null
  try {
    return safeStorage.decryptString(Buffer.from(stored, 'base64'))
  } catch (e) {
    // Если ключ DPAPI сменился (миграция OS / новый профиль) —
    // расшифровать невозможно, удаляем мёртвый blob
    store.delete(key)
    return null
  }
}

/**
 * @param {'bitbucketApiToken'|'dbPassword'} key
 */
export function clearSecret(key) {
  assertKey(key)
  store.delete(key)
}

/**
 * Возвращает карту key → boolean (есть ли значение). Не раскрывает значения.
 *
 * @returns {{ bitbucketApiToken: boolean, dbPassword: boolean }}
 */
export function secretsStatus() {
  return {
    bitbucketApiToken: store.has('bitbucketApiToken'),
    dbPassword: store.has('dbPassword')
  }
}
