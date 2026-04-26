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

  const clone = useMutation({
    mutationFn: () => api.git.clone(slug),
    onSuccess: () => {
      // local.cloned/runnableSubpath появятся при ре-enrich;
      // git-status и lastCommit подгрузятся лениво при открытии drawer'а.
      qc.invalidateQueries({ queryKey: ['bitbucket', 'projects'] })
      qc.invalidateQueries({ queryKey: ['git-status', slug] })
      qc.invalidateQueries({ queryKey: ['lastCommit', slug] })
    }
  })

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

  const dbCreate = useMutation({
    mutationFn: () => api.db.create(slug.toLowerCase()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bitbucket', 'projects'] })
    }
  })

  const dbDrop = useMutation({
    mutationFn: () => api.db.drop(slug.toLowerCase()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bitbucket', 'projects'] })
    }
  })

  return { clone, pull, run, stop, dbCreate, dbDrop }
}
