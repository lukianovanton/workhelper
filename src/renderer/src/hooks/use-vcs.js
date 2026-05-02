import { useQuery } from '@tanstack/react-query'
import { api } from '@/api'

const TWO_MIN = 2 * 60 * 1000
const FIVE_MIN = 5 * 60 * 1000
const ONE_HOUR = 60 * 60 * 1000
const FIFTEEN_SEC = 15 * 1000

/**
 * VCS-хуки (provider-agnostic). Раньше файл назывался use-bitbucket.js
 * и хуки звались usePipelines/usePipelineSteps; сейчас канонично —
 * useBuilds / useBuildSteps / useBuildStepLog. На BB это pipelines,
 * на GH — Actions runs, под капотом одинаково.
 *
 * QueryKey-namespace начинается с 'vcs' — единая точка инвалидации
 * для всего что приходит от провайдеров.
 */

/**
 * Список веток репо + дефолтная ветка.
 *
 * @param {string} slug
 */
export function useBranches(slug) {
  return useQuery({
    queryKey: ['vcs', 'branches', slug],
    queryFn: () => api.vcs.branches(slug),
    enabled: typeof slug === 'string' && slug.length > 0,
    staleTime: FIVE_MIN,
    retry: false
  })
}

/**
 * Детали одного коммита + diffstat.
 *
 * @param {string} slug
 * @param {string | null | undefined} hash
 * @param {{ enabled?: boolean }} [opts]
 */
export function useCommitDetail(slug, hash, opts = {}) {
  return useQuery({
    queryKey: ['vcs', 'commit-detail', slug, hash],
    queryFn: () => api.vcs.commitDetail(slug, hash),
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
 * Список билдов репо (BB pipelines / GH Actions runs). Авто-poll
 * каждые 15с пока есть IN_PROGRESS / PENDING.
 *
 * @param {string} slug
 * @param {{ pagelen?: number, branch?: string | null, enabled?: boolean }} [opts]
 */
export function useBuilds(slug, opts = {}) {
  const pagelen = opts.pagelen ?? 20
  const branch = opts.branch || null
  return useQuery({
    queryKey: ['vcs', 'builds', slug, pagelen, branch],
    queryFn: () => api.vcs.builds(slug, { pagelen, branch }),
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
 * Steps конкретного билда (на GH — jobs внутри workflow run).
 *
 * @param {string} slug
 * @param {string | null | undefined} buildUuid
 * @param {{ enabled?: boolean }} [opts]
 */
export function useBuildSteps(slug, buildUuid, opts = {}) {
  return useQuery({
    queryKey: ['vcs', 'build-steps', slug, buildUuid],
    queryFn: () => api.vcs.buildSteps(slug, buildUuid),
    enabled:
      opts.enabled !== false &&
      typeof slug === 'string' &&
      slug.length > 0 &&
      typeof buildUuid === 'string' &&
      buildUuid.length > 0,
    staleTime: TWO_MIN,
    retry: false
  })
}

/**
 * Unified-diff одного файла в коммите.
 *
 * @param {string} slug
 * @param {string | null | undefined} hash
 * @param {string | null | undefined} path
 * @param {{ enabled?: boolean }} [opts]
 */
export function useCommitFileDiff(slug, hash, path, opts = {}) {
  return useQuery({
    queryKey: ['vcs', 'commit-file-diff', slug, hash, path],
    queryFn: () => api.vcs.commitFileDiff(slug, hash, path),
    enabled:
      opts.enabled !== false &&
      typeof slug === 'string' &&
      slug.length > 0 &&
      typeof hash === 'string' &&
      hash.length > 0 &&
      typeof path === 'string' &&
      path.length > 0,
    staleTime: ONE_HOUR,
    retry: false
  })
}

/**
 * Лог step'а билда. Меняется только пока step running.
 *
 * @param {string} slug
 * @param {string | null | undefined} buildUuid
 * @param {string | null | undefined} stepUuid
 * @param {{ enabled?: boolean }} [opts]
 */
export function useBuildStepLog(slug, buildUuid, stepUuid, opts = {}) {
  return useQuery({
    queryKey: ['vcs', 'build-step-log', slug, buildUuid, stepUuid],
    queryFn: () => api.vcs.buildStepLog(slug, buildUuid, stepUuid),
    enabled:
      opts.enabled !== false &&
      typeof slug === 'string' &&
      slug.length > 0 &&
      typeof buildUuid === 'string' &&
      buildUuid.length > 0 &&
      typeof stepUuid === 'string' &&
      stepUuid.length > 0,
    staleTime: ONE_HOUR,
    retry: false
  })
}
