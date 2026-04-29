import { useQuery } from '@tanstack/react-query'
import { api } from '@/api'

const POLL_MS = 5000

/**
 * Live-список юзеров видимых в LAN/Tailscale через UDP-presence.
 * Поллит presence:list каждые 5 секунд. main сам делает cleanup
 * по TTL (60с без heartbeat → drop), так что список всегда свежий.
 *
 * Если presence выключен в Settings — main возвращает пустой массив,
 * это нормальное состояние.
 */
export function usePresence() {
  const sessionsQuery = useQuery({
    queryKey: ['presence', 'list'],
    queryFn: () => api.presence.list(),
    refetchInterval: POLL_MS,
    staleTime: 0,
    retry: false
  })
  const enabledQuery = useQuery({
    queryKey: ['presence', 'enabled'],
    queryFn: () => api.presence.isEnabled(),
    refetchInterval: POLL_MS,
    staleTime: 0,
    retry: false
  })
  const sessions = sessionsQuery.data || []
  return {
    sessions,
    enabled: !!enabledQuery.data,
    me: sessions.find((s) => s.isMe) || null,
    others: sessions.filter((s) => !s.isMe)
  }
}
