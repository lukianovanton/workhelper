import { useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import ProjectsList from './routes/projects-list.jsx'
import ProjectDetail from './routes/project-detail.jsx'
import Settings from './routes/settings.jsx'
import { useRestoreStore } from './store/restore.store.js'
import { useSetupStore } from './store/setup.store.js'
import { api } from './api'

export default function App() {
  useRestoreSubscription()
  useSetupSubscription()

  return (
    <Routes>
      <Route path="/" element={<Navigate to="/projects" replace />} />
      <Route path="/projects" element={<ProjectsList />}>
        <Route path=":slug" element={<ProjectDetail />} />
      </Route>
      <Route path="/settings" element={<Settings />} />
    </Routes>
  )
}

/**
 * Глобальный мост между main-эмиттером restore-событий и zustand-стором.
 * Живёт пока живо приложение, чтобы прогресс не терялся при unmount drawer'а.
 *
 *  - start    → store.start(slug, totalBytes)
 *  - progress → store.setProgress(...)
 *  - done     → store.done(...) + invalidate проекты (db.size обновится)
 *               + clear через 4с чтобы UI успел показать «Done»
 *  - error    → store.error(message), запись висит до closure × в drawer'е
 */
/**
 * Подписка на setup:event. Зеркалит фазы и шаги в zustand setup store
 * чтобы Setup Dialog корректно ресурсился при rerender.
 *
 *  - started → start()
 *  - step    → applyStep()
 *  - finished/failed/cancelled → терминальные фазы (UI потом сам clear)
 */
function useSetupSubscription() {
  const queryClient = useQueryClient()

  useEffect(() => {
    const unsub = api.setup.on((evt) => {
      if (!evt || typeof evt.slug !== 'string') return
      const store = useSetupStore.getState()
      switch (evt.kind) {
        case 'started':
          store.start(evt.slug)
          break
        case 'step':
          if (evt.step) store.applyStep(evt.slug, evt.step)
          break
        case 'finished':
          store.finished(evt.slug)
          // Свежий enrich: cloned/db.exists/dump/runnable могли поменяться
          queryClient.invalidateQueries({
            queryKey: ['bitbucket', 'projects']
          })
          break
        case 'failed':
          store.failed(evt.slug, evt.message || 'Setup failed')
          queryClient.invalidateQueries({
            queryKey: ['bitbucket', 'projects']
          })
          break
        case 'cancelled':
          store.cancelled(evt.slug)
          queryClient.invalidateQueries({
            queryKey: ['bitbucket', 'projects']
          })
          break
      }
    })
    return unsub
  }, [queryClient])
}

function useRestoreSubscription() {
  const queryClient = useQueryClient()

  useEffect(() => {
    const store = useRestoreStore.getState()
    const unsub = api.db.onRestore((evt) => {
      if (!evt || typeof evt.slug !== 'string') return
      switch (evt.kind) {
        case 'start':
          store.start(evt.slug, evt.totalBytes || 0)
          break
        case 'progress':
          store.setProgress(evt.slug, evt.bytesRead, evt.totalBytes)
          break
        case 'done':
          store.done(evt.slug, {
            bytesRead: evt.bytesRead,
            totalBytes: evt.totalBytes,
            dumpFile: evt.dumpFile
          })
          queryClient.invalidateQueries({
            queryKey: ['bitbucket', 'projects']
          })
          setTimeout(() => useRestoreStore.getState().clear(evt.slug), 4000)
          break
        case 'error':
          store.error(evt.slug, evt.message || 'Restore failed')
          break
      }
    })
    return unsub
  }, [queryClient])
}
