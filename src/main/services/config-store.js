/**
 * Persistent app config (без секретов — те через secrets.js).
 *
 * electron-store v8 (CJS). Файл лежит в `app.getPath('userData')/config.json`.
 *
 * @typedef {import('../../shared/types.js').AppConfig} AppConfig
 */

import Store from 'electron-store'

/** @type {AppConfig} */
const DEFAULTS = {
  bitbucket: {
    workspace: 'techgurusit',
    /** Atlassian account email (используется как username для Basic Auth с API token). */
    username: '',
    /**
     * Bitbucket username (НЕ email) — используется в URL `git clone`.
     * Аутентификация ложится на системный Git Credential Manager,
     * приложение НЕ передаёт токен в git-слой.
     */
    gitUsername: ''
  },
  paths: {
    projectsRoot: 'C:\\Projects',
    dumpsRoot: '',
    vscodeExecutable: 'code'
  },
  database: {
    host: 'localhost',
    port: 3306,
    user: 'root',
    mysqlExecutable: ''
  },
  dotnet: {
    runArgs: [],
    workingDirSubpathOverride: {}
  },
  presence: {
    enabled: false
  },
  jira: {
    /**
     * Корневой URL Jira Cloud, без слеша на конце. Для self-hosted
     * Server/DC формат другой, но REST API совместим.
     */
    host: '',
    /**
     * Atlassian email для Basic-авторизации REST API. Если пусто —
     * jira-client фолбэчится на bitbucket.username (тот же
     * Atlassian-аккаунт у большинства пользователей). Поле оставлено
     * на случай отдельных Atlassian-аккаунтов.
     */
    email: '',
    /**
     * Atlassian accountId — escape hatch когда автоматический резолв
     * (/myself / /user/search) не справился. Видно в URL Jira-профиля
     * пользователя: <host>/jira/people/<accountId>. Если задан —
     * используется напрямую в JQL вместо currentUser().
     */
    accountId: ''
  }
}

const store = new Store({
  name: 'config',
  defaults: DEFAULTS,
  clearInvalidConfig: true
})

/**
 * @returns {AppConfig}
 */
export function getConfig() {
  return store.store
}

/**
 * Глубоко мерджит patch в текущий конфиг и сохраняет.
 * Не валидирует структуру — фронт отвечает за корректность.
 *
 * @param {Partial<AppConfig>} patch
 */
export function setConfig(patch) {
  const current = store.store
  const merged = deepMerge(current, patch)
  store.store = merged
}

function deepMerge(target, source) {
  if (!isPlainObject(target) || !isPlainObject(source)) return source
  const out = { ...target }
  for (const [key, value] of Object.entries(source)) {
    if (isPlainObject(value) && isPlainObject(target[key])) {
      out[key] = deepMerge(target[key], value)
    } else {
      out[key] = value
    }
  }
  return out
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

export { DEFAULTS }
