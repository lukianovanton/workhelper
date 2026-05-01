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
 * для секций «Recent commits» / Commits-tab.
 *
 * Параметры: { pagelen, branch }. Без branch Bitbucket отдаёт
 * коммиты всех веток в хронологии — для Recent-preview это ОК.
 * В Commits-tab прокидываем выбранную ветку и тогда видны только
 * её коммиты.
 *
 * Старый positional-вызов useCommits(slug, 5) тоже работает —
 * число интерпретируется как pagelen. Так LastCommitSection
 * продолжает работать без изменений.
 *
 * @param {string} slug
 * @param {{ pagelen?: number, branch?: string | null } | number} [opts]
 */
export function useCommits(slug, opts = {}) {
  const o = typeof opts === 'number' ? { pagelen: opts } : opts || {}
  const pagelen = o.pagelen ?? 30
  const branch = o.branch || null
  return useQuery({
    queryKey: ['commits', slug, pagelen, branch],
    queryFn: () => api.bitbucket.commits(slug, { pagelen, branch }),
    enabled: typeof slug === 'string' && slug.length > 0,
    staleTime: FIVE_MIN,
    retry: false
  })
}
