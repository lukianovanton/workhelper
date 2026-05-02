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
import {
  getVcsProviderDef,
  isSupportedVcsType
} from './providers.js'

/**
 * @typedef {Object} VcsSource
 * @property {string} id
 * @property {string} type             'bitbucket' | 'github' | <future>
 * @property {string} name             user-facing label
 * @property {string} workspace        BB workspace slug / GH owner / GitLab group / etc.
 * @property {string} username         Atlassian email / VCS login
 * @property {string} gitUsername      git URL username
 * @property {string} secretKey        ключ в secrets store для API token'а
 */

/**
 * Список источников из config.sources[]. config-store сам мигрирует
 * legacy `bitbucket: {}` в sources[0] на первом чтении.
 *
 * Фильтруем на known types по VCS_PROVIDER_DEFS (см. providers.js).
 * Неизвестные type'ы (например при downgrade c новой версии) просто
 * скипаются — registry такие игнорирует, чтобы не упасть.
 *
 * @returns {VcsSource[]}
 */
function getSources() {
  const config = getConfig()
  const sources = Array.isArray(config.sources) ? config.sources : []
  return sources
    .filter((s) => s && isSupportedVcsType(s.type))
    .map((s) => ({
      id: s.id,
      type: s.type,
      name: s.name || s.workspace || getVcsProviderDef(s.type).fallbackName,
      workspace: s.workspace || '',
      username: s.username || '',
      gitUsername: s.gitUsername || '',
      // Provider-specific options. Каждый provider читает только свои
      // ключи из этого блока; неизвестные игнорятся. Это даёт расширяемый
      // канал для per-source настроек без расширения базового shape'а
      // (BB: templatePrefix; будущие GitLab/Azure DevOps добавят свои).
      providerOptions: s.providerOptions || {},
      secretKey: `vcs:${s.id}:token`
    }))
}

/** @type {Map<string, VcsProvider>} */
const providers = new Map()

function buildProvider(source) {
  const def = getVcsProviderDef(source.type)
  if (!def) {
    throw new Error(`Unknown VCS source type: ${source.type}`)
  }
  return def.factory({
    getWorkspace: () => {
      const fresh = getSources().find((s) => s.id === source.id)
      return fresh?.workspace || source.workspace
    },
    getUsername: () => {
      const fresh = getSources().find((s) => s.id === source.id)
      return fresh?.username || source.username
    },
    getToken: () => getSecret(source.secretKey),
    cacheKey: `vcs-cache-${source.id}`,
    // Provider-specific lazy getters. Каждый провайдер берёт только
    // те, что его волнуют; остальные игнорируются. Так контракт
    // фабрики остаётся плоским, а каждое расширение source.providerOptions
    // живёт здесь:
    //
    //   bitbucket: templatePrefix (default 'TP')
    //   gitlab:    baseUrl       (default 'https://gitlab.com';
    //                              для self-hosted указывает свой URL)
    getTemplatePrefix: () => {
      const fresh = getSources().find((s) => s.id === source.id) || source
      const opt = fresh.providerOptions?.templatePrefix
      return typeof opt === 'string' ? opt : 'TP'
    },
    getBaseUrl: () => {
      const fresh = getSources().find((s) => s.id === source.id) || source
      const opt = fresh.providerOptions?.baseUrl
      return typeof opt === 'string' && opt.trim() ? opt.trim() : ''
    }
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
        out.push({
          sourceId: source.id,
          sourceType: source.type,
          sourceName: source.name,
          repo
        })
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
