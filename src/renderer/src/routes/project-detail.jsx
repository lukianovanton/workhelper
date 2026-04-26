import { useRef, useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  X,
  ExternalLink,
  Code2,
  GitPullRequest,
  Play,
  Square,
  Loader2,
  CheckCircle2,
  XCircle,
  CircleDashed,
  GitCommit,
  Download,
  Plus,
  Trash2,
  DatabaseBackup,
  FolderOpen,
  Sparkles,
  Wrench,
  FolderInput,
  Star,
  StickyNote
} from 'lucide-react'
import { useProjects } from '@/hooks/use-projects'
import { useLastCommit } from '@/hooks/use-last-commit'
import { useRunningProcesses } from '@/hooks/use-running-processes'
import { useGitStatus } from '@/hooks/use-git-status'
import { useProjectActions } from '@/hooks/use-project-actions'
import { useRestoreStore } from '@/store/restore.store.js'
import { useProjectsMetaStore } from '@/store/projects-meta.store.js'
import { SetupDialog } from '@/components/setup-dialog.jsx'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { cn } from '@/lib/utils'
import { api } from '@/api'

export default function ProjectDetail() {
  const { slug } = useParams()
  const navigate = useNavigate()
  const { projects, warnings, isLoading: projectsLoading } = useProjects()
  const project = projects?.find((p) => p.slug === slug) || null
  const dbAvailable = !warnings.some((w) => /database/i.test(w))

  // Запоминаем «открыли drawer этого проекта» для секции Recent
  const touchRecent = useProjectsMetaStore((s) => s.touchRecent)
  useEffect(() => {
    if (slug) touchRecent(slug)
  }, [slug, touchRecent])

  // J/K (или ↑/↓) навигация между проектами не закрывая drawer.
  // Реагирует на keydown глобально, кроме случая когда фокус в input/textarea.
  useEffect(() => {
    if (!projects || !slug) return
    const onKey = (e) => {
      if (e.target?.tagName === 'INPUT' || e.target?.tagName === 'TEXTAREA')
        return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const idx = projects.findIndex((p) => p.slug === slug)
      if (idx === -1) return
      let nextIdx = null
      if (e.key === 'j' || e.key === 'ArrowDown') nextIdx = idx + 1
      else if (e.key === 'k' || e.key === 'ArrowUp') nextIdx = idx - 1
      if (nextIdx == null) return
      const next = projects[(nextIdx + projects.length) % projects.length]
      if (next) {
        e.preventDefault()
        navigate(`/projects/${next.slug}`)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [projects, slug, navigate])

  if (projectsLoading)
    return <DrawerShell onClose={() => navigate('/projects')} loading />
  if (!project)
    return (
      <DrawerNotFound slug={slug} onClose={() => navigate('/projects')} />
    )

  return (
    <Drawer
      project={project}
      dbAvailable={dbAvailable}
      onClose={() => navigate('/projects')}
    />
  )
}

function DrawerShell({ children, onClose, loading }) {
  return (
    <div className="w-1/2 border-l border-border bg-background flex flex-col">
      <header className="px-6 py-4 border-b border-border flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {loading ? 'Loading…' : 'Project'}
        </div>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <X />
        </Button>
      </header>
      {loading ? (
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
          <Loader2 className="animate-spin mr-2" /> Loading project…
        </div>
      ) : (
        children
      )}
    </div>
  )
}

function DrawerNotFound({ slug, onClose }) {
  return (
    <DrawerShell onClose={onClose}>
      <div className="flex-1 flex items-center justify-center text-center p-8">
        <div>
          <h3 className="font-medium">Project not found</h3>
          <p className="text-sm text-muted-foreground mt-1">
            <code>{slug}</code> is not in the current Bitbucket workspace
            list.
          </p>
        </div>
      </div>
    </DrawerShell>
  )
}

function Drawer({ project, dbAvailable, onClose }) {
  const cloned = project.local.cloned
  const { bySlug } = useRunningProcesses()
  const runtime = bySlug.get(project.slug) || null
  const isRunning = !!runtime

  const gitStatus = useGitStatus(project.slug, cloned)
  const { clone, pull, run, stop, dbCreate, dbDrop, dbRestore } =
    useProjectActions(project.slug)
  const restoreState = useRestoreStore((s) => s.bySlug[project.slug])
  const clearRestore = useRestoreStore((s) => s.clear)
  const favorites = useProjectsMetaStore((s) => s.favorites)
  const toggleFavorite = useProjectsMetaStore((s) => s.toggleFavorite)
  const notes = useProjectsMetaStore((s) => s.notes[project.slug] || '')
  const setNote = useProjectsMetaStore((s) => s.setNote)
  const isFavorite = !!favorites[project.slug]
  const [dropDialogOpen, setDropDialogOpen] = useState(false)
  const [replaceDialogOpen, setReplaceDialogOpen] = useState(false)
  const [pendingDumpPath, setPendingDumpPath] = useState(null)
  const [setupDialogOpen, setSetupDialogOpen] = useState(false)

  const [actionStatus, setActionStatus] = useState(null)
  const flashTimerRef = useRef(null)

  const clearFlashTimer = () => {
    if (flashTimerRef.current) {
      clearTimeout(flashTimerRef.current)
      flashTimerRef.current = null
    }
  }

  // Ошибки висят до явного закрытия (× или следующее действие);
  // ok/info авто-исчезают через 4с.
  const flash = (msg, kind = 'info') => {
    clearFlashTimer()
    setActionStatus({ msg, kind })
    if (kind !== 'error') {
      flashTimerRef.current = setTimeout(() => {
        setActionStatus(null)
        flashTimerRef.current = null
      }, 4000)
    }
  }

  const dismissStatus = () => {
    clearFlashTimer()
    setActionStatus(null)
  }

  const onClone = async () => {
    try {
      const res = await clone.mutateAsync()
      flash(`Cloned ${project.slug} to ${res?.path}`, 'ok')
    } catch (e) {
      flash(e?.message || String(e), 'error')
    }
  }

  const onOpenVSCode = async () => {
    try {
      const res = await api.editor.openInVSCode(project.slug)
      flash(`Opened ${res?.opened ?? project.local.path} in VS Code`, 'ok')
    } catch (e) {
      flash(e?.message || String(e), 'error')
    }
  }

  const onOpenFolder = async () => {
    try {
      await api.app.openFolder(project.local.path)
    } catch (e) {
      flash(e?.message || String(e), 'error')
    }
  }

  const onPull = async () => {
    try {
      const res = await pull.mutateAsync()
      const summary = res?.summary || ''
      const ok = res?.updated
        ? `Pulled ${project.slug}: ${summary}`
        : `${project.slug} ${summary.toLowerCase()}`
      flash(ok, 'ok')
    } catch (e) {
      flash(e?.message || String(e), 'error')
    }
  }

  const onRun = async () => {
    try {
      const res = await run.mutateAsync()
      flash(
        `Started ${project.slug} (PID ${res?.pid}). Waiting for port…`,
        'ok'
      )
    } catch (e) {
      flash(e?.message || String(e), 'error')
    }
  }

  const onStop = async () => {
    try {
      await stop.mutateAsync()
      flash(`Stopped ${project.slug}`, 'ok')
    } catch (e) {
      flash(e?.message || String(e), 'error')
    }
  }

  const onCreateDb = async () => {
    try {
      await dbCreate.mutateAsync()
      flash(`Database ${project.db.name} created`, 'ok')
    } catch (e) {
      flash(e?.message || String(e), 'error')
    }
  }

  const onConfirmDrop = async () => {
    setDropDialogOpen(false)
    try {
      await dbDrop.mutateAsync()
      flash(`Dropped database ${project.db.name}`, 'ok')
    } catch (e) {
      flash(e?.message || String(e), 'error')
    }
  }

  const startRestore = async (dumpPath) => {
    try {
      await dbRestore.mutateAsync({ dumpPath })
      // 'done' broadcasted from main и invalidate происходит в App.jsx,
      // здесь только UI feedback. flash через 100мс чтобы restore-store
      // успел очиститься у пользователя на глазах.
    } catch (e) {
      flash(e?.message || String(e), 'error')
    }
  }

  const replaceAndRestore = async (dumpPath) => {
    try {
      await dbDrop.mutateAsync()
      await dbCreate.mutateAsync()
      await startRestore(dumpPath)
    } catch (e) {
      flash(e?.message || String(e), 'error')
    }
  }

  const onRestoreFromDump = async (dumpPath) => {
    if (!dumpPath) return
    // Если БД пустая — restore без confirm
    if (!project.db.exists || !project.db.sizeBytes) {
      await startRestore(dumpPath)
      return
    }
    // Иначе — подтверждение замены
    setPendingDumpPath(dumpPath)
    setReplaceDialogOpen(true)
  }

  const onConfirmReplace = async () => {
    setReplaceDialogOpen(false)
    const dumpPath = pendingDumpPath
    setPendingDumpPath(null)
    if (dumpPath) await replaceAndRestore(dumpPath)
  }

  const onPickDump = async () => {
    try {
      const dumpPath = await api.fs.pickDump()
      if (dumpPath) await onRestoreFromDump(dumpPath)
    } catch (e) {
      flash(e?.message || String(e), 'error')
    }
  }

  return (
    <div className="w-1/2 border-l border-border bg-background flex flex-col overflow-hidden">
      <header className="px-6 py-4 border-b border-border space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => toggleFavorite(project.slug)}
                title={isFavorite ? 'Unpin' : 'Pin to top'}
                className={cn(
                  'transition-colors',
                  isFavorite
                    ? 'text-amber-400 hover:text-amber-300'
                    : 'text-muted-foreground/50 hover:text-amber-400'
                )}
              >
                <Star
                  size={14}
                  className={isFavorite ? 'fill-current' : ''}
                />
              </button>
              <h2 className="text-base font-semibold font-mono">
                {project.slug}
              </h2>
              <button
                onClick={() =>
                  window.open(project.bitbucket.url, '_blank')
                }
                className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                title={project.bitbucket.url}
              >
                {project.bitbucket.projectKey || 'workspace'}/
                {project.slug}
                <ExternalLink size={11} />
              </button>
            </div>
            {project.name !== project.slug && (
              <div className="text-sm mt-0.5">{project.name}</div>
            )}
            {project.description && (
              <div className="text-xs text-muted-foreground mt-1 line-clamp-2">
                {project.description}
              </div>
            )}
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X />
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          {!cloned ? (
            <>
              <Button
                size="sm"
                onClick={() => setSetupDialogOpen(true)}
                disabled={clone.isPending}
              >
                <Sparkles />
                Setup & Run
              </Button>
              <ActionButton
                icon={
                  clone.isPending ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Download />
                  )
                }
                onClick={onClone}
                disabled={clone.isPending}
                label={clone.isPending ? 'Cloning…' : 'Clone only'}
              />
            </>
          ) : (
            <>
              <ActionButton
                icon={<Code2 />}
                onClick={onOpenVSCode}
                label="Open in VS Code"
              />
              <ActionButton
                icon={<FolderInput />}
                onClick={onOpenFolder}
                label="Open folder"
              />
              <ActionButton
                icon={
                  pull.isPending ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <GitPullRequest />
                  )
                }
                onClick={onPull}
                disabled={pull.isPending || isRunning}
                disabledTooltip={
                  isRunning ? 'Stop the running process before pulling' : ''
                }
                label="Pull"
              />
              {isRunning ? (
                <>
                  <ActionButton
                    icon={
                      stop.isPending ? (
                        <Loader2 className="animate-spin" />
                      ) : (
                        <Square />
                      )
                    }
                    onClick={onStop}
                    disabled={stop.isPending}
                    label={`Stop${runtime?.port ? ` (:${runtime.port})` : ''}`}
                    destructive
                  />
                  {runtime?.url && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="px-2"
                      title={`Open ${runtime.url}`}
                      onClick={() => window.open(runtime.url, '_blank')}
                    >
                      <ExternalLink />
                    </Button>
                  )}
                </>
              ) : (
                <ActionButton
                  icon={
                    run.isPending ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <Play />
                    )
                  }
                  onClick={onRun}
                  disabled={run.isPending}
                  label="Run"
                />
              )}
              <ActionButton
                icon={<Wrench />}
                onClick={() => setSetupDialogOpen(true)}
                label="Setup remaining"
              />
            </>
          )}
        </div>
        {actionStatus && (
          <div
            className={
              'text-xs flex items-start gap-2 rounded-md px-2 py-1.5 border ' +
              (actionStatus.kind === 'error'
                ? 'text-destructive border-destructive/30 bg-destructive/5'
                : actionStatus.kind === 'ok'
                ? 'text-emerald-500 border-emerald-500/30 bg-emerald-500/5'
                : 'text-muted-foreground border-border')
            }
          >
            {actionStatus.kind === 'error' && (
              <XCircle size={14} className="mt-0.5 shrink-0" />
            )}
            {actionStatus.kind === 'ok' && (
              <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
            )}
            <div className="flex-1 break-words">{actionStatus.msg}</div>
            <button
              onClick={dismissStatus}
              className="shrink-0 -m-0.5 p-0.5 opacity-60 hover:opacity-100"
              title="Dismiss"
            >
              <X size={12} />
            </button>
          </div>
        )}
      </header>

      <div className="flex-1 overflow-auto p-6 space-y-4">
        <ChecklistRow
          state={project.local.cloned ? 'on' : 'off'}
          title={project.local.cloned ? 'Cloned' : 'Not cloned'}
          subtitle={
            project.local.cloned ? (
              <code className="text-xs">{project.local.path}</code>
            ) : (
              `Will live at ${project.local.path || '<projectsRoot>/' + project.slug.toLowerCase()}`
            )
          }
          right={<GitInline status={gitStatus.data} loading={gitStatus.isLoading} cloned={cloned} />}
        />
        <DbSection
          project={project}
          dbAvailable={dbAvailable}
          isRunning={isRunning}
          creating={dbCreate.isPending}
          dropping={dbDrop.isPending}
          restoreState={restoreState}
          onCreate={onCreateDb}
          onRequestDrop={() => setDropDialogOpen(true)}
          onRestoreAuto={() => onRestoreFromDump(project.db.dumpPath)}
          onPickDump={onPickDump}
          onClearRestoreState={() => clearRestore(project.slug)}
        />
        <ChecklistRow
          state={isRunning ? 'running' : 'idle'}
          title={
            isRunning
              ? `Running on :${runtime?.port ?? '?'}`
              : 'Not running'
          }
          subtitle={
            isRunning ? (
              <>
                PID {runtime?.pid} · Started{' '}
                {formatRelative(runtime?.startedAt)}
                {runtime?.port == null && (
                  <span className="text-muted-foreground/70">
                    {' '}· detecting port…
                  </span>
                )}
              </>
            ) : (
              '—'
            )
          }
        />

        {project.local.cloned && (
          <div className="text-xs text-muted-foreground pl-7">
            {project.local.runnableSubpath ? (
              <>
                Runnable subpath:{' '}
                <code>{project.local.runnableSubpath}</code>
              </>
            ) : (
              <span className="text-amber-500">
                ⚠️ Cannot detect runnable project. Set
                workingDirSubpath override in Settings.
              </span>
            )}
          </div>
        )}

        <Separator />

        <LastCommitSection slug={project.slug} />

        <Separator />

        <NotesSection
          value={notes}
          onChange={(v) => setNote(project.slug, v)}
        />
      </div>

      <AlertDialog open={dropDialogOpen} onOpenChange={setDropDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Drop database <code className="font-mono">{project.db.name}</code>?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete all data in the database. This
              action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={onConfirmDrop}
              className={cn(
                'bg-destructive text-destructive-foreground hover:bg-destructive/90'
              )}
            >
              Drop database
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <SetupDialog
        project={project}
        open={setupDialogOpen}
        onOpenChange={setSetupDialogOpen}
      />

      <AlertDialog
        open={replaceDialogOpen}
        onOpenChange={(open) => {
          setReplaceDialogOpen(open)
          if (!open) setPendingDumpPath(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Replace database <code className="font-mono">{project.db.name}</code>?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Database currently has{' '}
              <strong>{formatBytes(project.db.sizeBytes)}</strong> of data.
              Restoring will <strong>DROP and recreate</strong> it from{' '}
              <code className="font-mono">
                {pendingDumpPath
                  ? pendingDumpPath.split(/[\\/]/).pop()
                  : ''}
              </code>
              . Existing data will be permanently lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={onConfirmReplace}
              className={cn(
                'bg-destructive text-destructive-foreground hover:bg-destructive/90'
              )}
            >
              Replace and restore
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function DbSection({
  project,
  dbAvailable,
  isRunning,
  creating,
  dropping,
  restoreState,
  onCreate,
  onRequestDrop,
  onRestoreAuto,
  onPickDump,
  onClearRestoreState
}) {
  const dbExists = project.db.exists
  const isRestoring = restoreState && restoreState.status === 'running'
  const isFinishing =
    restoreState &&
    (restoreState.status === 'done' || restoreState.status === 'error')

  // Активно идёт restore — показываем прогресс-блок вместо кнопок
  if (isRestoring || isFinishing) {
    return (
      <RestoreProgress
        slug={project.slug}
        state={restoreState}
        onClearError={onClearRestoreState}
      />
    )
  }

  const dumpFilename = project.db.dumpFilename
  const dumpsRoot =
    project.db.dumpPath && dumpFilename
      ? project.db.dumpPath.slice(
          0,
          project.db.dumpPath.length - dumpFilename.length - 1
        )
      : null
  const dumpAge = project.db.dumpMtime
    ? formatRelative(new Date(project.db.dumpMtime).toISOString())
    : null

  return (
    <div className="flex items-start gap-3">
      <StateIcon state={dbExists ? 'on' : 'off'} />
      <div className="flex-1 min-w-0 space-y-2">
        <div>
          <div className="text-sm font-medium">
            {dbExists
              ? `DB ${project.db.name} exists`
              : `DB ${project.db.name} not found`}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {dbExists
              ? `Size: ${formatBytes(project.db.sizeBytes)}`
              : dumpFilename
              ? `Dump available: ${dumpFilename}`
              : 'No dump auto-detected'}
          </div>
        </div>

        {!dbAvailable ? (
          <div className="text-xs text-amber-500">
            Configure database connection in Settings to enable DB actions.
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {!dbExists ? (
              <Button
                variant="outline"
                size="sm"
                onClick={onCreate}
                disabled={creating}
              >
                {creating ? <Loader2 className="animate-spin" /> : <Plus />}
                Create database
              </Button>
            ) : (
              <>
                {project.db.dumpPath && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onRestoreAuto}
                    disabled={dropping || creating}
                    title={`Restore from ${project.db.dumpPath}`}
                  >
                    <DatabaseBackup />
                    Restore from {dumpFilename}
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onPickDump}
                  disabled={dropping || creating}
                >
                  <FolderOpen />
                  Restore from file…
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onRequestDrop}
                  disabled={dropping || isRunning}
                  title={
                    isRunning
                      ? 'Stop the running process before dropping the database'
                      : undefined
                  }
                  className={
                    isRunning
                      ? 'text-destructive/60'
                      : 'text-destructive border-destructive/40 hover:bg-destructive/10 hover:text-destructive'
                  }
                >
                  {dropping ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Trash2 />
                  )}
                  Drop database
                </Button>
              </>
            )}
          </div>
        )}

        {dbExists && project.db.dumpPath && dumpsRoot && (
          <div className="text-[11px] text-muted-foreground/70">
            Found in <code className="text-[11px]">{dumpsRoot}</code>
            {dumpAge && <> · {dumpAge}</>}
          </div>
        )}
      </div>
    </div>
  )
}

function RestoreProgress({ slug, state, onClearError }) {
  // Локальный таймер для актуального speed/ETA — без него UI обновляется
  // только на тиках main, и speed визуально дрожит
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(id)
  }, [])

  const status = state.status
  const total = state.totalBytes || 0
  const read = state.bytesRead || 0
  const percent =
    total > 0 ? Math.min(100, Math.floor((read / total) * 100)) : 0
  const elapsedMs = Math.max(1, now - state.startedAt)
  const speed = read / (elapsedMs / 1000)
  const remainingBytes = Math.max(0, total - read)
  const etaSec =
    speed > 1024 ? Math.round(remainingBytes / speed) : null

  return (
    <div className="flex items-start gap-3">
      <StateIcon
        state={
          status === 'done'
            ? 'on'
            : status === 'error'
            ? 'off'
            : 'running'
        }
      />
      <div className="flex-1 min-w-0 space-y-2">
        <div className="text-sm font-medium">
          {status === 'running' && `Restoring database ${slug.toLowerCase()}…`}
          {status === 'done' && `Restored ${slug.toLowerCase()}`}
          {status === 'error' && `Restore failed`}
        </div>

        {status !== 'error' && (
          <>
            <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
              <div
                className={cn(
                  'h-full transition-[width] duration-200 rounded-full',
                  status === 'done' ? 'bg-emerald-500' : 'bg-sky-500'
                )}
                style={{ width: `${percent}%` }}
              />
            </div>
            <div className="text-xs text-muted-foreground tabular-nums flex flex-wrap gap-x-3">
              <span>{percent}%</span>
              <span>
                {formatBytes(read)} / {formatBytes(total)}
              </span>
              {status === 'running' && speed > 0 && (
                <>
                  <span>{formatBytes(speed)}/s</span>
                  {etaSec != null && <span>ETA {formatDuration(etaSec)}</span>}
                </>
              )}
              {status === 'done' && state.dumpFile && (
                <span>from {state.dumpFile}</span>
              )}
            </div>
          </>
        )}

        {status === 'error' && (
          <div className="flex items-start gap-2 text-xs text-destructive border border-destructive/30 bg-destructive/5 rounded-md px-2 py-1.5">
            <XCircle size={14} className="mt-0.5 shrink-0" />
            <div className="flex-1 break-words">
              {state.message || 'Unknown error'}
            </div>
            <button
              onClick={onClearError}
              className="shrink-0 -m-0.5 p-0.5 opacity-60 hover:opacity-100"
              title="Dismiss"
            >
              <X size={12} />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function formatDuration(seconds) {
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}m ${String(s).padStart(2, '0')}s`
}


function GitInline({ status, loading, cloned }) {
  if (!cloned) return null
  if (loading) {
    return (
      <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
        <Loader2 size={12} className="animate-spin" /> status…
      </span>
    )
  }
  if (!status) return null
  const branch = status.branch || '?'
  return (
    <span className="text-xs text-muted-foreground inline-flex items-center gap-2">
      <code className="text-[11px]">{branch}</code>
      {status.dirty && <span className="text-amber-500">dirty</span>}
      {status.ahead > 0 && <span>↑{status.ahead}</span>}
      {status.behind > 0 && <span>↓{status.behind}</span>}
    </span>
  )
}

function ActionButton({
  icon,
  onClick,
  disabled,
  disabledTooltip,
  label,
  destructive
}) {
  return (
    <Button
      variant={destructive ? 'destructive' : 'outline'}
      size="sm"
      onClick={onClick}
      disabled={disabled}
      title={disabled && disabledTooltip ? disabledTooltip : undefined}
    >
      {icon}
      {label}
    </Button>
  )
}

function ChecklistRow({ state, title, subtitle, right }) {
  return (
    <div className="flex items-start gap-3">
      <StateIcon state={state} />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium">{title}</div>
        {subtitle && (
          <div className="text-xs text-muted-foreground mt-0.5 break-all">
            {subtitle}
          </div>
        )}
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  )
}

function StateIcon({ state }) {
  const cls = 'mt-0.5 shrink-0'
  switch (state) {
    case 'on':
      return <CheckCircle2 size={16} className={cls + ' text-emerald-500'} />
    case 'running':
      return <CheckCircle2 size={16} className={cls + ' text-sky-500'} />
    case 'off':
      return (
        <CircleDashed size={16} className={cls + ' text-muted-foreground'} />
      )
    case 'idle':
    default:
      return (
        <CircleDashed
          size={16}
          className={cls + ' text-muted-foreground/60'}
        />
      )
  }
}

function LastCommitSection({ slug }) {
  const { data, isLoading, isError } = useLastCommit(slug)

  return (
    <div className="space-y-2">
      <div className="text-xs uppercase tracking-wide text-muted-foreground flex items-center gap-2">
        <GitCommit size={12} /> Last commit
      </div>
      {isLoading && (
        <div className="space-y-1.5">
          <div className="h-3 bg-muted rounded w-3/4 animate-pulse" />
          <div className="h-3 bg-muted rounded w-1/2 animate-pulse" />
        </div>
      )}
      {!isLoading && (data == null || isError) && (
        <div className="text-sm text-muted-foreground">—</div>
      )}
      {!isLoading && data && (
        <div>
          <div className="text-sm font-medium whitespace-pre-line line-clamp-3">
            {data.message.trim() || '(no message)'}
          </div>
          <div className="text-xs text-muted-foreground mt-1 flex items-center gap-2">
            <span>{data.author}</span>
            <span>·</span>
            <span>{formatRelative(data.date)}</span>
            {data.hash && (
              <>
                <span>·</span>
                <code className="text-[10px]">{data.hash.slice(0, 7)}</code>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function NotesSection({ value, onChange }) {
  return (
    <div className="space-y-2">
      <div className="text-xs uppercase tracking-wide text-muted-foreground flex items-center gap-2">
        <StickyNote size={12} /> Notes
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Что-то про этот проект — баги, контакт людей, контекст…"
        rows={4}
        className="w-full bg-background border border-input rounded-md px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-y"
      />
      <p className="text-[10px] text-muted-foreground/70">
        Хранится локально, не синхронизируется между машинами.
      </p>
    </div>
  )
}

function formatBytes(n) {
  if (n == null || Number.isNaN(n)) return '—'
  if (n === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let v = n
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`
}

function formatRelative(iso) {
  if (!iso) return '—'
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return '—'
  const diff = Date.now() - then
  if (diff < 0) return 'just now'
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`
  const years = Math.floor(days / 365)
  return `${years}y ago`
}
