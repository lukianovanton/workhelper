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
 * для секции «Recent commits». Тот же кэш-ключ ['commits', slug, n]
 * — переживает закрытие/открытие drawer.
 */
export function useCommits(slug, pagelen = 5) {
  return useQuery({
    queryKey: ['commits', slug, pagelen],
    queryFn: () => api.bitbucket.commits(slug, pagelen),
    enabled: typeof slug === 'string' && slug.length > 0,
    staleTime: FIVE_MIN,
    retry: false
  })
}
