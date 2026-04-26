import { useQuery } from '@tanstack/react-query'
import { api } from '@/api'

const KEY = ['process', 'list']
const POLL_MS = 2000

/**
 * Список живых dotnet-процессов. Поллим каждые 2с — в renderer это
 * единственный источник правды о runtime-состоянии. Жёсткой синхронизации
 * не делаем: 1-2 сек лага между Run/Stop и обновлением точки в списке —
 * приемлемо.
 *
 * Можно ускорить через подписку на process:exit/port (preload даёт
 * api.process.on), но в MVP-1 поллинга достаточно.
 *
 * @returns {{
 *   running: {slug:string, pid:number, port:number|null, startedAt:string}[],
 *   bySlug: Map<string, {pid:number, port:number|null, startedAt:string}>,
 *   isLoading: boolean
 * }}
 */
export function useRunningProcesses() {
  const query = useQuery({
    queryKey: KEY,
    queryFn: () => api.process.list(),
    refetchInterval: POLL_MS,
    staleTime: 0,
    retry: false
  })
  const running = query.data || []
  const bySlug = new Map(running.map((r) => [r.slug, r]))
  return {
    running,
    bySlug,
    isLoading: query.isLoading
  }
}
