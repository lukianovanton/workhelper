import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api'

const KEY = ['bitbucket', 'projects']
const TEN_MIN = 10 * 60 * 1000

/**
 * Список проектов из Bitbucket + enrich по локальному состоянию.
 *
 * Главный кэш Bitbucket-данных — в main-процессе (10 мин TTL).
 * Enrich (fs/db) пересчитывается в main на каждый list-вызов.
 * TanStack Query держит результат в renderer и шарит между экранами.
 *
 * IPC возвращает { projects, warnings }:
 *  - projects — Project[] с заполненными local.cloned/db.exists/...
 *  - warnings — мягкие сообщения от enrich (БД недоступна и т.п.),
 *    UI показывает баннером без блокировки списка
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
  const query = useQuery({
    queryKey: KEY,
    queryFn: () => api.bitbucket.list(),
    staleTime: TEN_MIN,
    retry: false
  })

  const refresh = async () => {
    const fresh = await api.bitbucket.refresh()
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
