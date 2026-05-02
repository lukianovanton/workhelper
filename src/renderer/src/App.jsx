import { useEffect, useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import ProjectsList from './routes/projects-list.jsx'
import ProjectDetail from './routes/project-detail.jsx'
import Settings from './routes/settings.jsx'
import MyTasks from './routes/my-tasks.jsx'
import { UpdateBanner } from './components/update-banner.jsx'
import { Toaster } from './components/toaster.jsx'
import { useRestoreStore } from './store/restore.store.js'
import { useSetupStore } from './store/setup.store.js'
import { toast } from './store/toast.store.js'
import { api } from './api'

export default function App() {
  useRestoreSubscription()
  useSetupSubscription()
  useProcessExitSubscription()
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
        <Route path="/my-tasks" element={<MyTasks />} />
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
            queryKey: ['vcs', 'projects']
          })
          break
        case 'failed':
          store.failed(evt.slug, evt.message || 'Setup failed')
          toast.error(
            `Setup of ${evt.slug} failed: ${evt.message || 'unknown error'}`
          )
          queryClient.invalidateQueries({
            queryKey: ['vcs', 'projects']
          })
          break
        case 'cancelled':
          store.cancelled(evt.slug)
          toast.info(`Setup of ${evt.slug} cancelled`)
          queryClient.invalidateQueries({
            queryKey: ['vcs', 'projects']
          })
          break
      }
    })
    return unsub
  }, [queryClient])
}

/**
 * Подписка на process:exit. Когда процесс падает — особенно
 * рано (без обнаруженного порта) или с ненулевым exit code —
 * показываем toast с tail логов чтобы юзер увидел причину.
 * Раньше падение было «тихим»: «Started... Waiting for port…», а
 * потом просто исчезало без объяснения.
 */
function useProcessExitSubscription() {
  useEffect(() => {
    return api.process.on('exit', (evt) => {
      if (!evt || typeof evt.slug !== 'string') return
      const { slug, code, signal, exitedEarly, userStopped, tail } = evt
      // Юзер сам нажал Stop — не алармируем независимо от exit code'а.
      // На Windows tree-kill = taskkill /F, exit code обычно 1 без
      // signal'а; иначе мы бы орали «exit 1 before binding a port» на
      // совершенно нормальном завершении.
      if (userStopped) return
      // Чистый SIGTERM без кода — внешний kill (редко). Не шумим.
      if (signal === 'SIGTERM' && code == null) return
      // Завершение с кодом 0 после нормальной работы — обычное «готов»
      // (короткие скрипты типа build). Не алармируем.
      const failedExit = code !== 0 && code != null
      if (!failedExit && !exitedEarly) return

      const codeLabel =
        code != null ? `exit ${code}` : signal ? `signal ${signal}` : 'exited'
      const earlyHint = exitedEarly ? ' before binding a port' : ''
      const tailLines =
        tail && tail.length > 0
          ? `\n${tail.split('\n').slice(-4).join('\n')}`
          : ''
      toast.error(`${slug}: ${codeLabel}${earlyHint}.${tailLines}`)
    })
  }, [])
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
            queryKey: ['vcs', 'projects']
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
