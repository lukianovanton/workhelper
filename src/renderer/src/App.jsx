import { useEffect, useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import ProjectsList from './routes/projects-list.jsx'
import ProjectDetail from './routes/project-detail.jsx'
import Settings from './routes/settings.jsx'
import { UpdateBanner } from './components/update-banner.jsx'
import { Toaster } from './components/toaster.jsx'
import { useRestoreStore } from './store/restore.store.js'
import { useSetupStore } from './store/setup.store.js'
import { toast } from './store/toast.store.js'
import { api } from './api'

export default function App() {
  useRestoreSubscription()
  useSetupSubscription()
  const update = useUpdateBanner()

  return (
    <>
      {update.banner && (
        <UpdateBanner
          version={update.banner.version}
          onRestart={() => api.updater.quitAndInstall()}
          onDismiss={update.dismiss}
        />
      )}
      <Routes>
        <Route path="/" element={<Navigate to="/projects" replace />} />
        <Route path="/projects" element={<ProjectsList />}>
          <Route path=":slug" element={<ProjectDetail />} />
        </Route>
        <Route path="/settings" element={<Settings />} />
      </Routes>
      <Toaster />
    </>
  )
}

/**
 * Слушает updater:event. На 'available' просто логгирует — апдейт ещё
 * скачивается, дёргать пользователя рано. На 'downloaded' показывает
 * persistent-баннер сверху до dismiss или клика по Restart.
 */
function useUpdateBanner() {
  const [banner, setBanner] = useState(null)

  useEffect(() => {
    return api.updater.on((evt) => {
      if (!evt) return
      if (evt.kind === 'available') {
        console.log('[updater] update available:', evt.version)
      } else if (evt.kind === 'downloaded') {
        setBanner({ version: evt.version || null })
      }
    })
  }, [])

  return { banner, dismiss: () => setBanner(null) }
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
          toast.ok(`Setup of ${evt.slug} finished`)
          queryClient.invalidateQueries({
            queryKey: ['bitbucket', 'projects']
          })
          break
        case 'failed':
          store.failed(evt.slug, evt.message || 'Setup failed')
          toast.error(
            `Setup of ${evt.slug} failed: ${evt.message || 'unknown error'}`
          )
          queryClient.invalidateQueries({
            queryKey: ['bitbucket', 'projects']
          })
          break
        case 'cancelled':
          store.cancelled(evt.slug)
          toast.info(`Setup of ${evt.slug} cancelled`)
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
          toast.ok(
            `Restored ${evt.slug}${evt.dumpFile ? ` from ${evt.dumpFile}` : ''}`
          )
          queryClient.invalidateQueries({
            queryKey: ['bitbucket', 'projects']
          })
          setTimeout(() => useRestoreStore.getState().clear(evt.slug), 4000)
          break
        case 'error':
          store.error(evt.slug, evt.message || 'Restore failed')
          toast.error(
            `Restore failed for ${evt.slug}: ${evt.message || 'unknown error'}`
          )
          break
      }
    })
    return unsub
  }, [queryClient])
}
