/**
 * Реестр сконфигурированных VCS-источников.
 *
 * На входе — список Source-объектов:
 *   `{ id, type, name, workspace, username, gitUsername, secretKey }`
 * На выходе — провайдеры (build-once-per-id, кэшированные) +
 *  slug→sourceId-карта, заполняемая при `listAllProjects`.
 *
 * Phase A.4a: список Source'ов синтезируется на лету из legacy
 * `config.bitbucket.{}` (один source с id='bitbucket-default'). Когда
 * Phase A.4b добавит `config.sources[]` в AppConfig — эта функция
 * `getSources()` начнёт читать оттуда, остальное в реестре не меняется.
 *
 * Создание провайдера ленивое и memoized по id, чтобы listRepos cache
 * (per-source electron-store файл) не пересоздавался на каждый вызов.
 *
 * @typedef {import('./types.js').VcsProvider} VcsProvider
 */

import { getConfig } from '../config-store.js'
import { getSecret } from '../secrets.js'
import { createBitbucketProvider } from './bitbucket-provider.js'

const DEFAULT_BB_SOURCE_ID = 'bitbucket-default'

/**
 * @typedef {Object} VcsSource
 * @property {string} id
 * @property {'bitbucket'} type
 * @property {string} name             user-facing label
 * @property {string} workspace        BB workspace slug
 * @property {string} username         Atlassian email
 * @property {string} gitUsername      BB username (для git clone URL)
 * @property {string} secretKey        ключ в secrets store для API token'а
 */

/**
 * Текущий список источников. Phase A.4a фолбэчит на legacy bitbucket-поля.
 * Phase A.4b будет читать из config.sources[] напрямую.
 *
 * @returns {VcsSource[]}
 */
function getSources() {
  const config = getConfig()
  const bb = config.bitbucket || {}
  // Источник синтезируется всегда — даже если поля пустые. Provider
  // методы сами бросят с stage='config' при отсутствии креденшелов.
  return [
    {
      id: DEFAULT_BB_SOURCE_ID,
      type: 'bitbucket',
      name: bb.workspace ? bb.workspace : 'Bitbucket',
      workspace: bb.workspace || '',
      username: bb.username || '',
      gitUsername: bb.gitUsername || '',
      secretKey: 'bitbucketApiToken'
    }
  ]
}

/** @type {Map<string, VcsProvider>} */
const providers = new Map()

function buildProvider(source) {
  if (source.type !== 'bitbucket') {
    throw new Error(`Unknown VCS source type: ${source.type}`)
  }
  return createBitbucketProvider({
    getWorkspace: () => {
      const fresh = getSources().find((s) => s.id === source.id)
      return fresh?.workspace || source.workspace
    },
    getUsername: () => {
      const fresh = getSources().find((s) => s.id === source.id)
      return fresh?.username || source.username
    },
    getToken: () => getSecret(source.secretKey),
    cacheKey: `vcs-cache-${source.id}`
  })
}

/**
 * Возвращает провайдера для конкретного source. Если source unknown
 * — null. Provider сам инстанциируется лениво на первый вызов и
 * сохраняется в `providers` map'е.
 *
 * @param {string} sourceId
 * @returns {VcsProvider | null}
 */
export function getProvider(sourceId) {
  const source = getSources().find((s) => s.id === sourceId)
  if (!source) return null
  if (!providers.has(sourceId)) {
    providers.set(sourceId, buildProvider(source))
  }
  return providers.get(sourceId)
}

/**
 * Все сконфигурированные источники (без секретов).
 *
 * @returns {Array<{ id: string, type: string, name: string }>}
 */
export function listSources() {
  return getSources().map((s) => ({
    id: s.id,
    type: s.type,
    name: s.name
  }))
}

/** Полная форма (workspace + gitUsername etc) — для git-service. */
export function getSource(sourceId) {
  return getSources().find((s) => s.id === sourceId) || null
}

/**
 * Карта slug → sourceId, заполняется на каждом listAllProjects.
 * Используется per-slug IPC хендлерами чтобы знать, к какому source
 * адресовать запрос.
 *
 * @type {Map<string, string>}
 */
const slugToSourceId = new Map()

export function getSourceIdForSlug(slug) {
  return slugToSourceId.get(slug) || null
}

export function getProviderForSlug(slug) {
  const sourceId = slugToSourceId.get(slug)
  if (!sourceId) {
    // Фолбэк на единственный источник: до первого listProjects карта
    // пустая, но per-slug IPC уже могут прилететь (например getCommits).
    const sources = getSources()
    if (sources.length === 1) return getProvider(sources[0].id)
    return null
  }
  return getProvider(sourceId)
}

/**
 * Объединённый список репо со всех сконфигурированных источников.
 * Каждый repo тегается своим sourceId, slug→sourceId-карта обновляется.
 *
 * При коллизии slug между источниками — побеждает первый источник
 * (стабильный порядок из getSources). В Phase A.4b добавим warning
 * в UI на этот случай. Пока единственный source, проблема невозможна.
 *
 * @param {boolean} forceRefresh
 * @returns {Promise<Array<{ source: { providerId: string }, repo: import('./types.js').ProviderRepo }>>}
 */
export async function listAllRepos(forceRefresh = false) {
  const sources = getSources()
  const out = []
  // Перестраиваем slug-карту с нуля — иначе stale-записи остались бы
  // в памяти после удаления source.
  slugToSourceId.clear()

  for (const source of sources) {
    let repos
    try {
      repos = await getProvider(source.id).listRepos(forceRefresh)
    } catch (e) {
      // Один битый source не должен сваливать другие. Логи уйдут в main
      // консоль; UI получит warnings отдельно через enrich.
      // eslint-disable-next-line no-console
      console.warn(`[vcs registry] source ${source.id} listRepos failed:`, e.message)
      continue
    }
    for (const repo of repos) {
      if (!slugToSourceId.has(repo.slug)) {
        slugToSourceId.set(repo.slug, source.id)
        out.push({ sourceId: source.id, repo })
      }
      // Иначе slug уже занят первым источником — пропускаем.
    }
  }

  return out
}

/**
 * Сбросить кэшированные инстансы провайдеров. Вызывается при изменении
 * конфигурации источников (Phase A.4b — `sources:add/update/remove`).
 * До A.4b unused, но контракт стабильный.
 */
export function invalidateProviders() {
  providers.clear()
  slugToSourceId.clear()
}
