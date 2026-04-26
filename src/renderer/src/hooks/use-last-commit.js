import { useQuery } from '@tanstack/react-query'
import { api } from '@/api'

const FIVE_MIN = 5 * 60 * 1000

/**
 * Lazy-fetch последнего коммита из Bitbucket.
 * Вызывается при открытии Detail drawer; кэш переживает закрытие drawer
 * (queryKey не зависит от состояния компонента).
 *
 * 404/403 от main приходят как null — UI показывает «—» без эскалации.
 *
 * @param {string|undefined} slug
 */
export function useLastCommit(slug) {
  return useQuery({
    queryKey: ['lastCommit', slug],
    queryFn: () => api.bitbucket.lastCommit(slug),
    enabled: typeof slug === 'string' && slug.length > 0,
    staleTime: FIVE_MIN,
    retry: false
  })
}
