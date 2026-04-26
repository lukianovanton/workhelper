import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api'

/**
 * Pull / Run / Stop через TanStack mutation.
 * Все три инвалидируют связанные query-ключи на успех.
 *
 * @param {string} slug
 */
export function useProjectActions(slug) {
  const qc = useQueryClient()

  const pull = useMutation({
    mutationFn: () => api.git.pull(slug),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lastCommit', slug] })
      qc.invalidateQueries({ queryKey: ['git-status', slug] })
    }
  })

  const run = useMutation({
    mutationFn: () => api.process.run(slug),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['process', 'list'] })
    }
  })

  const stop = useMutation({
    mutationFn: () => api.process.stop(slug),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['process', 'list'] })
    }
  })

  return { pull, run, stop }
}
