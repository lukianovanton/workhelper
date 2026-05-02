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
 * @typedef {Object} ProjectSource
 * @property {string} providerId             ссылка на сконфигурированный
 *                                            VCS-источник (Phase A.4 даст
 *                                            пользователю несколько). До
 *                                            миграции — фиксированный
 *                                            'bitbucket-default'.
 * @property {string} repoSlug                slug у провайдера. У BB и GH
 *                                            slug уникален в рамках
 *                                            workspace/owner — соответствие
 *                                            (providerId + repoSlug)
 *                                            идентифицирует репо однозначно.
 * @property {{ projectKey?: string }} [providerData]
 *                                            Provider-specific extras которые
 *                                            UI хочет показать как-есть
 *                                            (BB project.key для тултипа kind).
 *                                            Не используется логикой ядра.
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
 * @property {string|null} dumpPath           абс. путь к дампу если найден
 * @property {string|null} dumpFilename       basename, как в файловой системе
 * @property {number|null} dumpMtime          mtime в ms — для «3h ago»-отметки
 *                                            свежести найденного дампа
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
 * @property {string} slug                   стабильный идентификатор внутри
 *                                            приложения. Пока совпадает с
 *                                            source.repoSlug для одного-
 *                                            провайдерной конфигурации;
 *                                            при мульти-source потенциально
 *                                            расходится (workspace/repo
 *                                            могут давать одинаковый slug у
 *                                            разных провайдеров).
 * @property {string} name
 * @property {string} [description]
 * @property {ProjectKind} kind
 * @property {ProjectSource} source          ссылка на провайдер + repoSlug,
 *                                            заменяет старое `bitbucket: {}`.
 * @property {string} url                    web-URL у провайдера
 * @property {string} cloneUrl               HTTPS clone URL без креденшелов
 * @property {string|null} updatedOn         ISO timestamp последнего апдейта
 *                                            у провайдера; используется для
 *                                            сортировки и превью.
 * @property {LocalInfo} local
 * @property {DbInfo} db
 * @property {RuntimeInfo} runtime
 */

/**
 * @typedef {Object} DbConnectionConfig
 * @property {string} id                       стабильный идентификатор
 *                                              ('mysql-default' для миграции,
 *                                              UUID для добавленных через UI)
 * @property {'mysql'} type                     type engine'а; в Phase C
 *                                              расширится до 'postgres'
 * @property {string} name                      user-facing label
 * @property {string} host
 * @property {number} port
 * @property {string} user
 * @property {string} executable                абсолютный путь к CLI
 *                                              (mysql.exe / psql), либо ''
 *                                              для PATH-резолва
 *
 * @typedef {Object} VcsSourceConfig
 * @property {string} id                       стабильный идентификатор
 *                                              (UUID для добавленных через UI;
 *                                              'bitbucket-default' для
 *                                              мигрированного legacy)
 * @property {'bitbucket'} type                 type provider'а; в Phase B
 *                                              расширится до 'github' и т.д.
 * @property {string} name                      user-facing label
 * @property {string} workspace                 BB workspace slug (для GitHub
 *                                              станет owner)
 * @property {string} username                  Atlassian email для Basic Auth
 * @property {string} gitUsername               BB username (для URL git clone).
 *                                              Не email.
 *
 * @typedef {Object} AppConfig
 * @property {VcsSourceConfig[]} sources         сконфигурированные VCS-источники.
 *                                              Может быть пустым (тогда listAll
 *                                              repos возвращает []).
 *                                              API-токен каждого источника
 *                                              хранится в secrets под ключом
 *                                              `vcs:${source.id}:token`.
 * @property {DbConnectionConfig[]} databases   сконфигурированные DB-подключения.
 *                                              Пароль каждого хранится в
 *                                              secrets под ключом
 *                                              `db:${database.id}:password`.
 * @property {{ workspace: string, username: string, gitUsername: string }} [bitbucket]
 *           ⚠️ DEPRECATED. Сохранён как источник миграции для случая когда
 *           пользователь обновляется с до-A.4b версии. После первого
 *           getConfig() значения переезжают в sources[0] и поле
 *           перестаёт читаться. Phase A.7 удалит окончательно.
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
 * @property {{
 *   enabled: boolean
 * }} presence
 *           UDP-broadcast presence в LAN/Tailscale-сети. Когда true —
 *           main-процесс шлёт по UDP пакеты «я живой» с hostname,
 *           username, IP, версией; собирает такие же от других. См.
 *           services/presence-service.js. Default: false.
 */

/**
 * @typedef {Object} SetupStep
 * @property {'clone'|'db-create'|'db-restore'|'workspace'} kind
 * @property {'start'|'progress'|'done'|'error'} status
 * @property {number} [percent]                 только для db-restore
 * @property {string} [message]
 */

export {}
