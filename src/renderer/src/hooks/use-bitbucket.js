import { useQuery } from '@tanstack/react-query'
import { api } from '@/api'

const TWO_MIN = 2 * 60 * 1000
const FIFTEEN_SEC = 15 * 1000

/**
 * Детали одного коммита + diffstat. Lazy: enabled управляется
 * родителем (типично — раскрытием строки в Commits-tab). Кэш
 * долгий — содержимое коммита неизменное по hash, ему не нужен
 * TTL короче 2 минут.
 *
 * @param {string} slug
 * @param {string | null | undefined} hash
 * @param {{ enabled?: boolean }} [opts]
 */
export function useCommitDetail(slug, hash, opts = {}) {
  return useQuery({
    queryKey: ['commit-detail', slug, hash],
    queryFn: () => api.bitbucket.commitDetail(slug, hash),
    enabled:
      opts.enabled !== false &&
      typeof slug === 'string' &&
      slug.length > 0 &&
      typeof hash === 'string' &&
      hash.length > 0,
    staleTime: TWO_MIN,
    retry: false
  })
}

/**
 * Список пайплайнов репо. Авто-poll каждые 15 секунд если в выдаче
 * есть IN_PROGRESS / PENDING — это делает ленту «живой» во время
 * деплоя. Всё что в COMPLETED/FAILED/STOPPED уходит в обычный
 * 2-минутный staleTime.
 *
 * @param {string} slug
 * @param {{ pagelen?: number, enabled?: boolean }} [opts]
 */
export function usePipelines(slug, opts = {}) {
  const pagelen = opts.pagelen ?? 20
  return useQuery({
    queryKey: ['pipelines', slug, pagelen],
    queryFn: () => api.bitbucket.pipelines(slug, { pagelen }),
    enabled:
      opts.enabled !== false &&
      typeof slug === 'string' &&
      slug.length > 0,
    staleTime: TWO_MIN,
    retry: false,
    refetchInterval: (query) => {
      const list = query?.state?.data
      if (!Array.isArray(list) || list.length === 0) return false
      const live = list.some(
        (p) => p.state === 'IN_PROGRESS' || p.state === 'PENDING'
      )
      return live ? FIFTEEN_SEC : false
    }
  })
}

/**
 * Steps конкретного пайплайна. Lazy: вызываем когда пользователь
 * раскрывает строку. Step list сам по себе короткий и редкий —
 * 2-минутный staleTime + ручной invalidate из Pipelines-таба
 * (через refetchInterval родителя) достаточно.
 *
 * @param {string} slug
 * @param {string | null | undefined} pipelineUuid
 * @param {{ enabled?: boolean }} [opts]
 */
export function usePipelineSteps(slug, pipelineUuid, opts = {}) {
  return useQuery({
    queryKey: ['pipeline-steps', slug, pipelineUuid],
    queryFn: () => api.bitbucket.pipelineSteps(slug, pipelineUuid),
    enabled:
      opts.enabled !== false &&
      typeof slug === 'string' &&
      slug.length > 0 &&
      typeof pipelineUuid === 'string' &&
      pipelineUuid.length > 0,
    staleTime: TWO_MIN,
    retry: false
  })
}
