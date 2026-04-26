import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api'

const KEY = ['bitbucket', 'projects']
const TEN_MIN = 10 * 60 * 1000

/**
 * Список проектов из Bitbucket. Главный кэш — в main-процессе
 * (electron-store, TTL 10 мин). TanStack Query держит то же значение
 * в renderer для компонентов.
 *
 * @returns {{
 *   projects: import('@shared/types.js').Project[] | undefined,
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
    projects: query.data,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
    refresh
  }
}
