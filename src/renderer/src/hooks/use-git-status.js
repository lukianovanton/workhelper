import { useQuery } from '@tanstack/react-query'
import { api } from '@/api'

const THIRTY_S = 30 * 1000

/**
 * Статус git working tree (dirty/branch/ahead/behind).
 * Lazy-fetch по slug, queryKey ['git-status', slug], staleTime 30с.
 * Вызывается из Detail drawer; после Pull инвалидируется руками.
 *
 * @param {string|undefined} slug
 * @param {boolean} enabled — только для cloned проектов
 */
export function useGitStatus(slug, enabled = true) {
  return useQuery({
    queryKey: ['git-status', slug],
    queryFn: () => api.git.status(slug),
    enabled: !!slug && enabled,
    staleTime: THIRTY_S,
    retry: false
  })
}
