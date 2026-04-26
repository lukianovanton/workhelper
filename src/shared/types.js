/**
 * Project Hub — JSDoc-типизация общих структур.
 * Соответствует разделу 5 спеки (с правками по итогам обсуждения).
 *
 * Файл — namespace-носитель для VS Code intellisense.
 * Импортировать сами typedef'ы не нужно: достаточно сослаться через
 * `@type {import('@shared/types.js').Project}` в JSDoc.
 */

/**
 * @typedef {'project' | 'template'} ProjectKind
 * Резолвится из repo.project.key (Bitbucket API):
 *   key.startsWith('TP') → 'template'
 *   иначе                → 'project'
 * НЕ парсить из slug — слаги бывают произвольные (affiliatecrm, crmac).
 */

/**
 * @typedef {Object} BitbucketCommit
 * @property {string} message
 * @property {string} author
 * @property {string} date    ISO timestamp
 * @property {string} hash
 */

/**
 * @typedef {Object} BitbucketInfo
 * @property {string} url             https://bitbucket.org/techgurusit/p0070
 * @property {string} cloneUrl        HTTPS clone URL
 * @property {BitbucketCommit} [lastCommit]
 */

/**
 * @typedef {Object} LocalInfo
 * @property {string|null} path               projectsRoot/slug.toLowerCase()
 * @property {boolean} cloned
 * @property {boolean} dirty                  есть несохранённые изменения
 * @property {string|null} branch
 * @property {{ ahead: number, behind: number }} [aheadBehind]
 * @property {string|null} lastPullAt         ISO timestamp из state cache
 * @property {string|null} runnableSubpath    отн. путь к папке с Program.cs
 *                                            (см. 9.5 спеки). null если
 *                                            не определён — кнопка Run
 *                                            блокируется в UI.
 */

/**
 * @typedef {Object} DbInfo
 * @property {string} name                    slug.toLowerCase() — всегда
 * @property {boolean} exists
 * @property {number|null} sizeBytes
 * @property {string|null} dumpPath           путь к дампу если найден
 */

/**
 * @typedef {Object} RuntimeInfo
 * @property {boolean} running
 * @property {number|null} pid
 * @property {number|null} port
 * @property {string|null} startedAt
 */

/**
 * @typedef {Object} Project
 * @property {string} slug                   как пришёл из Bitbucket
 *                                            (для отображения и API-обращений)
 * @property {string} name
 * @property {string} [description]
 * @property {ProjectKind} kind
 * @property {BitbucketInfo} bitbucket
 * @property {LocalInfo} local
 * @property {DbInfo} db
 * @property {RuntimeInfo} runtime
 */

/**
 * @typedef {Object} AppConfig
 * @property {{ workspace: string, username: string }} bitbucket
 *           username = Atlassian account email.
 *           apiToken хранится через safeStorage отдельно (ключ
 *           bitbucketApiToken). До сен. 2025 это был app password —
 *           Atlassian задепрекейтил, схема Basic Auth не изменилась.
 * @property {{
 *   projectsRoot: string,
 *   dumpsRoot: string,
 *   vscodeExecutable: string
 * }} paths
 *           projectsRoot default = 'C:\\Projects'
 *           vscodeExecutable default = 'code' (PATH)
 *           workspaceFilePattern удалён — glob *.code-workspace per-проект (9.5)
 * @property {{
 *   host: string,
 *   port: number,
 *   user: string,
 *   mysqlExecutable: string
 * }} database
 *           password — через safeStorage
 *           mysqlExecutable — абсолютный путь к mysql CLI (или пусто).
 *           В MVP-1 не используется. В MVP-2 при пустом значении —
 *           UI показывает подсказку, операция не падает.
 * @property {{
 *   runArgs: string[],
 *   workingDirSubpathOverride?: Object<string, string>
 * }} dotnet
 *           workingDirSubpath резолвится автоматически (9.5).
 *           workingDirSubpathOverride — карта slug → подпуть для случаев,
 *           когда автодетект не сработал (задаётся вручную в Settings).
 */

/**
 * @typedef {Object} SetupStep
 * @property {'clone'|'db-create'|'db-restore'|'workspace'} kind
 * @property {'start'|'progress'|'done'|'error'} status
 * @property {number} [percent]                 только для db-restore
 * @property {string} [message]
 */

export {}
