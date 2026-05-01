import { useQuery } from '@tanstack/react-query'
import { api } from '@/api'

const FIVE_MIN = 5 * 60 * 1000

export function useLastCommit(slug) {
  return useQuery({
    queryKey: ['lastCommit', slug],
    queryFn: () => api.bitbucket.lastCommit(slug),
    enabled: typeof slug === 'string' && slug.length > 0,
    staleTime: FIVE_MIN,
    retry: false
  })
}

/**
 * Lazy-fetch последних N коммитов. Дёргается при открытии drawer
 * для секций «Recent commits» / Commits-tab. Тот же кэш-ключ
 * ['commits', slug, n] — переживает закрытие/открытие drawer.
 *
 * Default pagelen=30 совпадает со спекой Чекпоинта 13 для Commits-tab.
 * LastCommitSection / превью продолжает звать с pagelen=5 — ключ кэша
 * у них раздельный, конфликта нет.
 */
export function useCommits(slug, pagelen = 30) {
  return useQuery({
    queryKey: ['commits', slug, pagelen],
    queryFn: () => api.bitbucket.commits(slug, pagelen),
    enabled: typeof slug === 'string' && slug.length > 0,
    staleTime: FIVE_MIN,
    retry: false
  })
}
