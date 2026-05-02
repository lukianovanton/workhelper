/**
 * Контракт VcsProvider — единый интерфейс источников репозиториев,
 * которым пользуется приложение. На момент Phase A.1 единственный
 * реализатор — BitbucketProvider; в Phase B добавится GitHubProvider.
 *
 * Все методы провайдера — async, бросают `Error` с человеческим
 * `message`. Где есть смысл — провайдер переписывает HTTP-коды
 * (401/403/404/429) в осмысленные сообщения. Где данные просто
 * отсутствуют (private/удалённое репо, нет пайплайнов) — возвращает
 * пустой результат вместо ошибки, чтобы UI показывал «нет данных»
 * без эскалации.
 *
 * Унифицированная терминология:
 *   - Bitbucket «pipelines» / GitHub «workflow runs» → builds
 *   - Bitbucket «steps» / GitHub «jobs»               → buildSteps
 *
 * Repo-shape провайдера — generic объект, описанный в @typedef ProviderRepo
 * ниже. Маппинг в полную Project-модель приложения происходит выше
 * по стеку (Phase A.3); провайдер не знает про local/db/runtime.
 */

/**
 * @typedef {Object} ProviderRepo
 * @property {string} slug                  идентификатор репо у провайдера
 * @property {string} name                  человеческое имя
 * @property {string} description
 * @property {'project' | 'template'} kind  template если это шаблон-репо
 *                                          (BB: project.key начинается с 'TP')
 * @property {string} url                   web-URL репо
 * @property {string} cloneUrl              HTTPS clone URL без креденшелов
 * @property {string|null} updatedOn        ISO timestamp последнего апдейта
 * @property {string} [projectKey]          BB-specific группировка
 */

/**
 * @typedef {Object} ProviderCommit
 * @property {string} hash
 * @property {string} message
 * @property {string} date                  ISO timestamp
 * @property {string} author                display name
 * @property {string|null} authorAccountId  идентификатор у провайдера для
 *                                          cross-link с issue tracker
 * @property {string[]} parents             хеши родительских коммитов
 */

/**
 * @typedef {Object} ProviderCommitDetail
 * @property {string} hash
 * @property {string} message
 * @property {string} date
 * @property {string} author
 * @property {string|null} authorAccountId
 * @property {string[]} parents
 * @property {{
 *   filesChanged: number,
 *   linesAdded: number,
 *   linesRemoved: number,
 *   files: Array<{
 *     status: string,
 *     linesAdded: number,
 *     linesRemoved: number,
 *     path: string
 *   }>,
 *   truncated: boolean
 * } | null} diffstat
 * @property {string} url                   web-URL коммита
 */

/**
 * @typedef {Object} ProviderBuild
 * @property {string} uuid                  идентификатор билда у провайдера
 * @property {number} buildNumber           инкрементальный номер
 * @property {string} state                 SUCCESSFUL | FAILED | STOPPED |
 *                                          ERROR | EXPIRED | IN_PROGRESS |
 *                                          PAUSED | PENDING | HALTED
 * @property {string} createdOn
 * @property {string|null} completedOn
 * @property {number|null} durationSeconds
 * @property {string|null} branch
 * @property {string|null} commitHash
 * @property {string} author
 * @property {string} url
 */

/**
 * @typedef {Object} ProviderBuildStep
 * @property {string} uuid
 * @property {string} name
 * @property {string} state
 * @property {number|null} durationSeconds
 */

/**
 * @typedef {Object} ProviderBranches
 * @property {string|null} defaultBranch
 * @property {string[]} branches            default подняли в начало списка
 */

/**
 * @typedef {{ ok: true, user?: any, workspace?: any } |
 *          { ok: false, stage: string, message: string, detail?: string }
 *         } TestConnectionResult
 */

/**
 * @typedef {Object} VcsProvider
 * @property {string} type                  стабильный идентификатор
 *                                          реализации ('bitbucket', 'github')
 *
 * @property {() => Promise<TestConnectionResult>} testConnection
 *   Двухступенчатая проверка (auth + access к workspace/owner).
 *
 * @property {(forceRefresh?: boolean) => Promise<ProviderRepo[]>} listRepos
 *   Полный список репо. forceRefresh=true обходит локальный кэш провайдера.
 *
 * @property {(slug: string) => Promise<ProviderRepo | null>} getRepo
 *   Один репо по slug; null если 404/403.
 *
 * @property {(slug: string, opts?: { pagelen?: number, branch?: string|null })
 *   => Promise<ProviderCommit[]>} getCommits
 *
 * @property {(slug: string, hash: string)
 *   => Promise<ProviderCommitDetail | null>} getCommitDetail
 *
 * @property {(slug: string, hash: string, path: string)
 *   => Promise<string>} getCommitFileDiff
 *   Возвращает unified-diff одного файла; пустая строка при 404/403.
 *
 * @property {(slug: string) => Promise<ProviderBranches>} getBranches
 *
 * @property {(slug: string, opts?: { pagelen?: number, branch?: string|null })
 *   => Promise<ProviderBuild[]>} getBuilds
 *   На Bitbucket — pipelines, на GitHub будет workflow runs.
 *
 * @property {(slug: string, buildUuid: string)
 *   => Promise<ProviderBuildStep[]>} getBuildSteps
 *
 * @property {(slug: string, buildUuid: string, stepUuid: string)
 *   => Promise<string>} getBuildStepLog
 *   text/plain лог шага; пустая строка если ещё нет/недоступен.
 *
 * @property {(slug: string)
 *   => Promise<{message: string, author: string, date: string, hash: string} | null>
 *   } getLastCommit
 *   Шорткат для UI «последний коммит» без diffstat.
 *
 * @property {(slug: string, gitUsername: string) => string} getCloneUrl
 *   Синхронно строит HTTPS clone URL для git-слоя. gitUsername
 *   подставляется в URL для подсказки credential-helper'у системного git.
 *
 * @property {(slug: string) => Promise<string[]>} listRootFiles
 *   Имена файлов и папок в корне репо (без рекурсии), на default-ветке.
 *   Используется pre-clone стек-детектором (`*.sln`, `package.json`,
 *   `Cargo.toml` и т.д.). Возвращает [] на 404/403 — UI должен
 *   показать «не определилось».
 *
 * @property {(slug: string, path: string) => Promise<string|null>} getFileText
 *   Raw-текст файла на default-ветке. Для манифестов pre-clone
 *   детектора (package.json → проверка deps на pg/prisma/...). null
 *   если 404 / файл бинарный / слишком большой по мнению провайдера.
 */

export {}
