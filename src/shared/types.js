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
 *                                            VCS-источник.
 * @property {('bitbucket'|'github')} [type]  type provider'а — продублирован
 *                                            из VcsSourceConfig, чтобы UI
 *                                            мог рисовать бейдж без
 *                                            дополнительного запроса.
 * @property {string} repoSlug                slug у провайдера.
 * @property {{ projectKey?: string }} [providerData]
 *                                            Provider-specific extras.
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
 * @property {{ runCommand: string }} defaults  дефолтные значения для всех
 *                                              новых проектов. runCommand
 *                                              — full command line ('dotnet
 *                                              run' / 'npm run dev' /
 *                                              'go run .'). Парсится в
 *                                              process-manager на bin + args.
 * @property {Object<string, { runCommand?: string, cwd?: string }>} runOverrides
 *                                              per-project оверрайды
 *                                              runCommand и/или cwd
 *                                              (рабочей директории
 *                                              относительно project root).
 * @property {Object<string, { databaseId?: string, name?: string }>} databaseOverrides
 *                                              per-project оверрайды БД:
 *                                              databaseId — id из
 *                                              databases[] (если у
 *                                              проекта другой engine
 *                                              чем default), name —
 *                                              имя БД (если оно не
 *                                              совпадает со slug).
 * @property {{
 *   projectsRoot: string,
 *   dumpsRoot: string,
 *   vscodeExecutable: string
 * }} paths
 *           projectsRoot default = 'C:\\Projects'
 *           vscodeExecutable default = 'code' (PATH)
 *
 * Phase A.7: legacy ключи `bitbucket`, `database`, `dotnet` удалены из
 * схемы и из persisted state. Если пользователь обновляется с до-A.4b
 * версии, migrateConfig() переносит данные и удаляет ключи на первом
 * запуске. Дальше — единая мульти-source/мульти-engine/per-project-run
 * модель.
 *
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
 * @property {'clone'|'db-create'|'db-restore'|'deps'|'workspace'} kind
 * @property {'start'|'progress'|'done'|'error'} status
 * @property {number} [percent]                 только для db-restore
 * @property {string} [message]
 */

export {}
