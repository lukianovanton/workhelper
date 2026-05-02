import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api'
import { usePrefsStore } from '@/store/prefs.store.js'

const KEY = ['vcs', 'projects']
const TEN_MIN = 10 * 60 * 1000

/**
 * Список проектов со всех настроенных VCS-источников + enrich по
 * локальному состоянию.
 *
 * Кэш per-source данных живёт в main (10 мин TTL внутри каждого
 * provider'а). Enrich (fs/db, мульти-engine) пересчитывается на
 * каждый list-вызов. TanStack Query держит результат в renderer и
 * шарит между экранами.
 *
 * IPC возвращает { projects, warnings }:
 *  - projects — Project[] с заполненными local.cloned/db.exists/...
 *  - warnings — мягкие сообщения от enrich (БД недоступна и т.п.),
 *    UI показывает баннером без блокировки списка.
 *
 * @returns {{
 *   projects: import('@shared/types.js').Project[] | undefined,
 *   warnings: string[],
 *   isLoading: boolean,
 *   isFetching: boolean,
 *   error: Error | null,
 *   refresh: () => Promise<void>
 * }}
 */
export function useProjects() {
  const queryClient = useQueryClient()
  const autoRefreshMs = usePrefsStore((s) => s.autoRefreshMs)
  const query = useQuery({
    queryKey: KEY,
    queryFn: () => api.vcs.list(),
    staleTime: TEN_MIN,
    refetchInterval: autoRefreshMs > 0 ? autoRefreshMs : false,
    refetchIntervalInBackground: false,
    retry: false
  })

  const refresh = async () => {
    const fresh = await api.vcs.refresh()
    queryClient.setQueryData(KEY, fresh)
  }

  return {
    projects: query.data?.projects,
    warnings: query.data?.warnings ?? [],
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
    refresh
  }
}
