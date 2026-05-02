/**
 * Backend-side реестр VCS-провайдеров. Замещает прежние if-каскады
 * (`if (type === 'bitbucket') ... if (type === 'github')`) которые
 * жили в registry.js, sources.ipc.js, и т.д. Добавление нового
 * провайдера = одна запись здесь + новый файл-имплементация.
 *
 * Контракт `factory(opts)` единый: получает getWorkspace/getUsername/
 * getToken/cacheKey, возвращает VcsProvider. Провайдеры с другой
 * терминологией (GitHub'у нужен getOwner) адаптируются здесь же —
 * snippet'ом-обёрткой, чтобы внешний контракт оставался одинаковым.
 *
 * @typedef {import('./types.js').VcsProvider} VcsProvider
 *
 * @typedef {Object} VcsProviderDef
 * @property {(opts: {
 *   getWorkspace: () => string,
 *   getUsername: () => string,
 *   getToken: () => string|null,
 *   cacheKey: string
 * }) => VcsProvider} factory
 * @property {string} idPrefix       префикс UUID-подобного source id (`bb-`, `gh-`)
 * @property {string} fallbackName   человеческое имя по-умолчанию
 */

import { createBitbucketProvider } from './bitbucket-provider.js'
import { createGitHubProvider } from './github-provider.js'
import { createGitLabProvider } from './gitlab-provider.js'
import { createAzureDevOpsProvider } from './azure-provider.js'

/** @type {Record<string, VcsProviderDef>} */
export const VCS_PROVIDER_DEFS = {
  bitbucket: {
    factory: createBitbucketProvider,
    idPrefix: 'bb',
    fallbackName: 'Bitbucket'
  },
  github: {
    factory: ({ getWorkspace, getUsername, getToken, cacheKey }) =>
      createGitHubProvider({
        // У GitHub'а workspace-поле — это `owner`, имя терминологически
        // отличается. Адаптер маппит, чтобы внешний контракт оставался
        // унифицированным.
        getOwner: getWorkspace,
        getUsername,
        getToken,
        cacheKey
      }),
    idPrefix: 'gh',
    fallbackName: 'GitHub'
  },
  gitlab: {
    factory: createGitLabProvider,
    idPrefix: 'gl',
    fallbackName: 'GitLab'
  },
  azure: {
    factory: createAzureDevOpsProvider,
    idPrefix: 'az',
    fallbackName: 'Azure DevOps'
  }
}

export function getVcsProviderDef(type) {
  return VCS_PROVIDER_DEFS[type] || null
}

export function isSupportedVcsType(type) {
  return !!VCS_PROVIDER_DEFS[type]
}

export function listVcsTypes() {
  return Object.keys(VCS_PROVIDER_DEFS)
}
