import { useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import ProjectsList from './routes/projects-list.jsx'
import ProjectDetail from './routes/project-detail.jsx'
import Settings from './routes/settings.jsx'
import { useRestoreStore } from './store/restore.store.js'
import { api } from './api'

export default function App() {
  useRestoreSubscription()

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
