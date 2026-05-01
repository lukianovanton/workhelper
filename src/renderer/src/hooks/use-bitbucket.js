import { useQuery } from '@tanstack/react-query'
import { api } from '@/api'

const TWO_MIN = 2 * 60 * 1000
const FIVE_MIN = 5 * 60 * 1000
const ONE_HOUR = 60 * 60 * 1000
const FIFTEEN_SEC = 15 * 1000

/**
 * Список веток репо + дефолтная ветка. Меняются редко — кэшируем
 * на 5 минут. Используется в BranchPicker (drawer) и для
 * автоинициализации выбранной ветки.
 *
 * @param {string} slug
 */
export function useBranches(slug) {
  return useQuery({
    queryKey: ['branches', slug],
    queryFn: () => api.bitbucket.branches(slug),
    enabled: typeof slug === 'string' && slug.length > 0,
    staleTime: FIVE_MIN,
    retry: false
  })
}

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
 * Branch-фильтр прокидывается в queryKey — переключение ветки
 * даёт отдельный кэш-bucket, без cross-pollination.
 *
 * @param {string} slug
 * @param {{ pagelen?: number, branch?: string | null, enabled?: boolean }} [opts]
 */
export function usePipelines(slug, opts = {}) {
  const pagelen = opts.pagelen ?? 20
  const branch = opts.branch || null
  return useQuery({
    queryKey: ['pipelines', slug, pagelen, branch],
    queryFn: () => api.bitbucket.pipelines(slug, { pagelen, branch }),
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

/**
 * Unified-diff одного файла в коммите. Содержимое неизменное —
 * staleTime 1 час, чтобы повторные раскрытия одного и того же
 * файла не дёргали API. Lazy: enabled=true только когда
 * пользователь раскрыл файл в Commits-tab.
 *
 * @param {string} slug
 * @param {string | null | undefined} hash
 * @param {string | null | undefined} path
 * @param {{ enabled?: boolean }} [opts]
 */
export function useCommitFileDiff(slug, hash, path, opts = {}) {
  return useQuery({
    queryKey: ['commit-file-diff', slug, hash, path],
    queryFn: () => api.bitbucket.commitFileDiff(slug, hash, path),
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
 * Лог step'а пайплайна. Меняется только пока step ещё running —
 * для уже COMPLETED step'а лог замораживается. По факту:
 *   - если step завершён, можно кешировать долго (1 час),
 *   - если step активен, хочется свежий лог.
 * Хук не знает state шага — это решает родитель: enabled=false
 * на активный (мы пока сами не реализовали стрим), enabled=true
 * на завершённый. Это безопасный дефолт: на активном step'е
 * пользователь увидит "log not yet available", может перейти на
 * Bitbucket. Когда step завершится и пайплайн обновится —
 * родитель размонтирует/перемонтирует это, и enabled=true даст
 * актуальный лог.
 *
 * @param {string} slug
 * @param {string | null | undefined} pipelineUuid
 * @param {string | null | undefined} stepUuid
 * @param {{ enabled?: boolean }} [opts]
 */
export function usePipelineStepLog(slug, pipelineUuid, stepUuid, opts = {}) {
  return useQuery({
    queryKey: ['pipeline-step-log', slug, pipelineUuid, stepUuid],
    queryFn: () =>
      api.bitbucket.pipelineStepLog(slug, pipelineUuid, stepUuid),
    enabled:
      opts.enabled !== false &&
      typeof slug === 'string' &&
      slug.length > 0 &&
      typeof pipelineUuid === 'string' &&
      pipelineUuid.length > 0 &&
      typeof stepUuid === 'string' &&
      stepUuid.length > 0,
    staleTime: ONE_HOUR,
    retry: false
  })
}
