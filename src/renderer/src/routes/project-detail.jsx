import { useRef, useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
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
  StickyNote,
  ChevronRight,
  ChevronDown,
  Workflow,
  AlertCircle,
  Clock,
  Pause,
  CircleSlash,
  RefreshCw,
  ListTodo,
  Calendar
} from 'lucide-react'
import { useQueryClient, useIsFetching } from '@tanstack/react-query'
import { useProjects } from '@/hooks/use-projects'
import { useLastCommit, useCommits } from '@/hooks/use-last-commit'
import {
  useCommitDetail,
  usePipelines,
  usePipelineSteps,
  useBranches,
  useCommitFileDiff,
  usePipelineStepLog
} from '@/hooks/use-bitbucket'
import {
  useJiraProjectForSlug,
  useProjectJiraIssues,
  useProjectClosedJiraIssues,
  useMyJiraIssues,
  useJiraIssueDetail,
  findSlugMentions
} from '@/hooks/use-jira'
import {
  TaskDetailContent,
  OpenInJiraLink,
  StatusBadge,
  SlugMismatchBadge,
  Avatar
} from '@/routes/my-tasks'
import { ErrorState as SharedErrorState } from '@/components/states'
import { useT } from '@/i18n'
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
  const [searchParams] = useSearchParams()
  const { projects, warnings, isLoading: projectsLoading } = useProjects()
  const project = projects?.find((p) => p.slug === slug) || null
  const dbAvailable = !warnings.some((w) => /database/i.test(w))
  // Deep-linking из My Tasks: ?tab=tasks&issue=PZJA-1 открывает
  // нужный таб и сразу разворачивает указанную задачу в Tasks-табе.
  // Captured один раз на mount и больше не меняется — это initial
  // hint, дальше пользователь рулит сам.
  const initialTab = searchParams.get('tab') || null
  const initialIssue = searchParams.get('issue') || null

  // Запоминаем «открыли drawer этого проекта» для секции Recent
  const touchRecent = useProjectsMetaStore((s) => s.touchRecent)
  useEffect(() => {
    if (slug) touchRecent(slug)
  }, [slug, touchRecent])

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
      initialTab={initialTab}
      initialIssue={initialIssue}
    />
  )
}

function DrawerShell({ children, onClose, loading }) {
  const t = useT()
  return (
    <aside className="w-1/2 border-l border-border bg-background flex flex-col">
      <header className="px-6 py-4 border-b border-border flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {loading ? t('drawer.loadingShort') : t('drawer.project')}
        </div>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <X />
        </Button>
      </header>
      {loading ? (
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
          <Loader2 className="animate-spin mr-2" /> {t('drawer.loading')}
        </div>
      ) : (
        children
      )}
    </aside>
  )
}

function DrawerNotFound({ slug, onClose }) {
  const t = useT()
  return (
    <DrawerShell onClose={onClose}>
      <div className="flex-1 flex items-center justify-center text-center p-8">
        <div>
          <h3 className="font-medium">{t('drawer.notFound.title')}</h3>
          <p className="text-sm text-muted-foreground mt-1">
            {t('drawer.notFound.message', { slug })}
          </p>
        </div>
      </div>
    </DrawerShell>
  )
}

function Drawer({ project, dbAvailable, onClose, initialTab, initialIssue }) {
  const t = useT()
  const cloned = project.local.cloned
  const { bySlug } = useRunningProcesses()
  const runtime = bySlug.get(project.slug) || null
  const isRunning = !!runtime

  const gitStatus = useGitStatus(project.slug, cloned)
  const { clone, pull, run, stop, dbCreate, dbDrop, dbRestore, checkout } =
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
  // Tab внутри drawer'а. Сессионный (per-mount), не персистится —
  // когда переключаешь проекты, default снова Overview.
  // initialTab из query params (?tab=tasks) — приходит из My Tasks
  // когда пользователь делает «Open in project».
  const [activeTab, setActiveTab] = useState(() => {
    const allowed = ['overview', 'commits', 'pipelines', 'tasks']
    return allowed.includes(initialTab) ? initialTab : 'overview'
  })

  // Выбранная ветка — общая для Commits и Pipelines табов. null =
  // «все ветки» (Bitbucket вернёт коммиты/пайплайны без фильтра).
  // При первом загруженном списке веток мы автоматически выставляем
  // default ветку (mainbranch.name). Дальше пользователь сам рулит;
  // touched защищает от перезаписи следующими refetch'ами.
  const [selectedBranch, setSelectedBranch] = useState(null)
  const [branchTouched, setBranchTouched] = useState(false)
  const branchesQuery = useBranches(project.slug)
  const defaultBranch = branchesQuery.data?.defaultBranch || null
  useEffect(() => {
    if (!branchTouched && defaultBranch) {
      setSelectedBranch(defaultBranch)
    }
  }, [defaultBranch, branchTouched])
  const onBranchChange = (b) => {
    setSelectedBranch(b)
    setBranchTouched(true)
  }

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
    <aside className="w-1/2 border-l border-border bg-background flex flex-col overflow-hidden">
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
                {t('drawer.action.setupAndRun')}
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
                label={
                  clone.isPending
                    ? t('drawer.action.cloning')
                    : t('drawer.action.cloneOnly')
                }
              />
            </>
          ) : (
            <>
              <ActionButton
                icon={<Code2 />}
                onClick={onOpenVSCode}
                label={t('drawer.action.openVSCode')}
              />
              <ActionButton
                icon={<FolderInput />}
                onClick={onOpenFolder}
                label={t('drawer.action.openFolder')}
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
                  isRunning ? t('drawer.action.pullDisabled.running') : ''
                }
                label={t('drawer.action.pull')}
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
                    label={
                      runtime?.port
                        ? t('drawer.action.stopWithPort', {
                            port: runtime.port
                          })
                        : t('drawer.action.stop')
                    }
                    destructive
                  />
                  {runtime?.url && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="px-2"
                      title={t('projects.row.openInBrowser', {
                        url: runtime.url
                      })}
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
                  label={t('drawer.action.run')}
                />
              )}
              <ActionButton
                icon={<Wrench />}
                onClick={() => setSetupDialogOpen(true)}
                label={t('drawer.action.setupRemaining')}
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

      <DrawerTabs active={activeTab} onChange={setActiveTab} />
      {activeTab !== 'overview' && (
        <TabActionBar
          activeTab={activeTab}
          slug={project.slug}
          branch={selectedBranch}
          branchesQuery={branchesQuery}
          onBranchChange={onBranchChange}
        />
      )}

      <div className="flex-1 overflow-auto">
        {activeTab === 'overview' && (
          <OverviewTab>
        <ChecklistRow
          state={project.local.cloned ? 'on' : 'off'}
          title={
            project.local.cloned
              ? t('drawer.checklist.cloned')
              : t('drawer.checklist.notCloned')
          }
          subtitle={
            project.local.cloned ? (
              <code className="text-xs">{project.local.path}</code>
            ) : (
              t('drawer.checklist.willLiveAt', {
                path:
                  project.local.path ||
                  '<projectsRoot>/' + project.slug.toLowerCase()
              })
            )
          }
          right={
            cloned ? (
              <BranchSwitcher
                slug={project.slug}
                gitStatus={gitStatus.data}
                gitLoading={gitStatus.isLoading}
                checkout={checkout}
                isRunning={isRunning}
                onResult={flash}
              />
            ) : null
          }
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
              ? t('drawer.checklist.runningOn', {
                  port: runtime?.port ?? '?'
                })
              : t('drawer.checklist.notRunning')
          }
          subtitle={
            isRunning ? (
              <>
                {t('drawer.checklist.pidStarted', {
                  pid: runtime?.pid,
                  time: formatRelative(runtime?.startedAt)
                })}
                {runtime?.port == null && (
                  <span className="text-muted-foreground/70">
                    {' '}· {t('drawer.checklist.detectingPort')}
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
              t('drawer.checklist.runnableSubpath', {
                path: project.local.runnableSubpath
              })
            ) : (
              <span className="text-amber-500">
                {t('drawer.checklist.cantDetectRunnable')}
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
          </OverviewTab>
        )}
        {activeTab === 'commits' && (
          <CommitsTab project={project} branch={selectedBranch} />
        )}
        {activeTab === 'pipelines' && (
          <PipelinesTab project={project} branch={selectedBranch} />
        )}
        {activeTab === 'tasks' && (
          <TasksTab project={project} initialIssue={initialIssue} />
        )}
      </div>

      <AlertDialog open={dropDialogOpen} onOpenChange={setDropDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('drawer.dropDialog.title', { name: project.db.name })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('drawer.dropDialog.description')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={onConfirmDrop}
              className={cn(
                'bg-destructive text-destructive-foreground hover:bg-destructive/90'
              )}
            >
              {t('drawer.dropDialog.confirm')}
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
              {t('drawer.replaceDialog.title', { name: project.db.name })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('drawer.replaceDialog.description', {
                size: formatBytes(project.db.sizeBytes),
                file: pendingDumpPath
                  ? pendingDumpPath.split(/[\\/]/).pop()
                  : ''
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={onConfirmReplace}
              className={cn(
                'bg-destructive text-destructive-foreground hover:bg-destructive/90'
              )}
            >
              {t('drawer.replaceDialog.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </aside>
  )
}

/**
 * Полоска табов под header'ом drawer'а. Активный таб — нижний
 * border accent-цветом, без анимации (анимация лишний шум при
 * частых переключениях). Стик не делаем — табы всё равно
 * остаются вверху scrollable-контейнера.
 *
 * Действия (refresh, branch picker) живут в отдельной полосе
 * TabActionBar ниже — так группа табов остаётся «чистой
 * навигацией», а действия не толкаются с lable'ами.
 */
function DrawerTabs({ active, onChange }) {
  const t = useT()
  const tabs = [
    { id: 'overview', label: t('drawer.tab.overview') },
    { id: 'commits', label: t('drawer.tab.commits'), icon: GitCommit },
    { id: 'pipelines', label: t('drawer.tab.pipelines'), icon: Workflow },
    { id: 'tasks', label: t('drawer.tab.tasks'), icon: ListTodo }
  ]
  return (
    <div className="flex items-center px-3 border-b border-border bg-background/60">
      {tabs.map((t) => {
        const Icon = t.icon
        const on = active === t.id
        return (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            className={cn(
              'inline-flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 -mb-px transition-colors',
              on
                ? 'border-foreground text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            {Icon && <Icon size={13} />}
            {t.label}
          </button>
        )
      })}
    </div>
  )
}

/**
 * Объединённая полоса действий под табами для Commits и
 * Pipelines: BranchPicker слева, Refresh справа. Refresh
 * контекстен активному табу — invalidate'ит соответствующие
 * queryKey'и для текущего slug. Иконка превращается в крутящийся
 * Loader2, пока идёт fetch (включая 15-секундный авто-poll
 * пайплайнов) — отдельный «auto-refreshing» hint поэтому не нужен.
 */
function TabActionBar({
  activeTab,
  slug,
  branch,
  branchesQuery,
  onBranchChange
}) {
  const t = useT()
  const queryClient = useQueryClient()
  const isFetching =
    useIsFetching({
      predicate: (q) => {
        const key = q.queryKey[0]
        if (activeTab === 'commits' || activeTab === 'pipelines') {
          if (q.queryKey[1] !== slug) return false
        }
        if (activeTab === 'commits') {
          return key === 'commits' || key === 'commit-detail'
        }
        if (activeTab === 'pipelines') {
          return key === 'pipelines' || key === 'pipeline-steps'
        }
        if (activeTab === 'tasks') {
          // Jira queries не привязаны к slug — фетчим список проектов
          // и issues по project key. Просто учитываем все 'jira' ключи.
          return key === 'jira'
        }
        return false
      }
    }) > 0

  const refresh = () => {
    if (activeTab === 'commits') {
      queryClient.invalidateQueries({ queryKey: ['commits', slug] })
      queryClient.invalidateQueries({ queryKey: ['commit-detail', slug] })
    } else if (activeTab === 'pipelines') {
      queryClient.invalidateQueries({ queryKey: ['pipelines', slug] })
      queryClient.invalidateQueries({ queryKey: ['pipeline-steps', slug] })
    } else if (activeTab === 'tasks') {
      queryClient.invalidateQueries({ queryKey: ['jira', 'project-issues'] })
      queryClient.invalidateQueries({ queryKey: ['jira', 'issue-detail'] })
      queryClient.invalidateQueries({ queryKey: ['jira', 'projects'] })
    }
  }

  // Branch picker применим только для commits/pipelines — таски
  // без понятия "ветка". На tasks-табе слева пусто, refresh
  // справа.
  const showBranchPicker = activeTab === 'commits' || activeTab === 'pipelines'

  return (
    <div className="px-6 py-2 border-b border-border/40 flex items-center gap-3 text-xs">
      {showBranchPicker && (
        <BranchPicker
          branchesQuery={branchesQuery}
          value={branch}
          onChange={onBranchChange}
        />
      )}
      <button
        onClick={refresh}
        disabled={isFetching}
        title={
          isFetching ? t('drawer.tab.refreshing') : t('drawer.tab.refresh')
        }
        className={cn(
          'ml-auto p-1.5 rounded transition-colors',
          isFetching
            ? 'text-sky-400'
            : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
        )}
      >
        {isFetching ? (
          <Loader2 size={13} className="animate-spin" />
        ) : (
          <RefreshCw size={13} />
        )}
      </button>
    </div>
  )
}

/**
 * Тонкая обёртка с padding и spacing — оставлена как отдельный
 * компонент, чтобы JSX основного Drawer'а оставался читаемым,
 * и при необходимости легко добавить scroll-restoration / sticky
 * sub-header'ы Overview-таба.
 */
function OverviewTab({ children }) {
  return <div className="p-6 space-y-4">{children}</div>
}

/**
 * Commits-таб: 30 последних коммитов с раскрытием детали по клику.
 * Только один коммит раскрыт за раз (accordion-поведение). При
 * раскрытии лениво грузится getCommitDetail с diffstat.
 */
function CommitsTab({ project, branch }) {
  const t = useT()
  const slug = project.slug
  const { data, isLoading, isError, refetch } = useCommits(slug, {
    pagelen: 30,
    branch
  })
  const [expandedHash, setExpandedHash] = useState(null)

  const toggle = (hash) =>
    setExpandedHash((prev) => (prev === hash ? null : hash))

  if (isLoading) {
    return (
      <div className="p-6 space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="space-y-1.5">
            <div className="h-3 bg-muted rounded w-3/4 animate-pulse" />
            <div className="h-3 bg-muted rounded w-1/2 animate-pulse" />
          </div>
        ))}
      </div>
    )
  }
  if (isError) {
    return <TabErrorState onRetry={refetch} />
  }
  if (!data || data.length === 0) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        {branch
          ? t('drawer.commits.emptyOnBranch', { branch })
          : t('drawer.commits.empty') + '.'}
      </div>
    )
  }
  return (
    <div className="divide-y divide-border/60">
      {data.map((c) => (
        <CommitRow
          key={c.hash}
          slug={slug}
          commit={c}
          expanded={expandedHash === c.hash}
          onToggle={() => toggle(c.hash)}
        />
      ))}
    </div>
  )
}

function CommitRow({ slug, commit, expanded, onToggle }) {
  const t = useT()
  const detail = useCommitDetail(slug, commit.hash, { enabled: expanded })
  const Caret = expanded ? ChevronDown : ChevronRight
  const firstLine =
    (commit.message || '').split('\n')[0] || t('drawer.commits.noMessage')
  return (
    <div>
      <button
        onClick={onToggle}
        className="w-full text-left px-6 py-2.5 flex items-center gap-3 hover:bg-accent/40 transition-colors"
      >
        <Caret size={14} className="shrink-0 text-muted-foreground" />
        <code className="text-[10px] font-mono shrink-0 text-muted-foreground">
          {commit.hash.slice(0, 7)}
        </code>
        <span className="text-sm flex-1 min-w-0 truncate">{firstLine}</span>
        <span className="text-[11px] text-muted-foreground shrink-0 truncate max-w-[10rem]">
          {commit.author}
        </span>
        <span className="text-[11px] text-muted-foreground shrink-0">
          {formatRelative(commit.date)}
        </span>
      </button>
      {expanded && (
        <div className="px-6 pb-4 pl-[2.25rem] text-sm space-y-3 bg-muted/20">
          <CommitDetailContent
            slug={slug}
            commit={commit}
            detail={detail}
          />
        </div>
      )}
    </div>
  )
}

function CommitDetailContent({ slug, commit, detail }) {
  const t = useT()
  // Раскрытый файл — для inline-diff. Только один открыт за раз;
  // повторный клик по тому же закрывает.
  const [openedFile, setOpenedFile] = useState(null)

  if (detail.isLoading) {
    return (
      <div className="py-3 text-xs text-muted-foreground inline-flex items-center gap-2">
        <Loader2 size={12} className="animate-spin" />{' '}
        {t('drawer.commits.loadingDiff')}
      </div>
    )
  }
  if (detail.isError || !detail.data) {
    return (
      <div className="py-3 text-xs text-destructive">
        {t('drawer.commits.cantLoadDetails')}
      </div>
    )
  }
  const d = detail.data
  const ds = d.diffstat
  // Первая строка message уже показана в строке-заголовке — повторно
  // её не рендерим. Если у коммита есть body (всё что после первого
  // \n), показываем только body — он несёт реальную дополнительную
  // информацию. У однострочных коммитов pre-блок просто не появляется.
  const body = (commit.message || '')
    .split('\n')
    .slice(1)
    .join('\n')
    .trim()
  return (
    <>
      {body && (
        <pre className="text-xs whitespace-pre-wrap font-sans bg-background/60 border border-border/40 rounded px-3 py-2">
          {body}
        </pre>
      )}
      {ds && ds.filesChanged > 0 ? (
        <div className="space-y-1.5">
          <div className="text-[11px] text-muted-foreground inline-flex items-center gap-2">
            <span>
              {ds.filesChanged === 1
                ? t('drawer.commits.filesChanged.one', { count: 1 })
                : t('drawer.commits.filesChanged.many', {
                    count: ds.filesChanged
                  })}
            </span>
            <span className="text-emerald-500">+{ds.linesAdded}</span>
            <span className="text-destructive">-{ds.linesRemoved}</span>
            {ds.truncated && (
              <span className="text-amber-500">
                {t('drawer.commits.truncated')}
              </span>
            )}
          </div>
          <ul className="text-xs font-mono space-y-0.5">
            {ds.files.map((f, i) => {
              const open = openedFile === f.path
              return (
                <li key={f.path + i}>
                  <button
                    onClick={() =>
                      setOpenedFile(open ? null : f.path)
                    }
                    className={cn(
                      'w-full flex items-center gap-2 px-1 -mx-1 rounded text-left transition-colors',
                      open ? 'bg-accent/40' : 'hover:bg-accent/30'
                    )}
                  >
                    {open ? (
                      <ChevronDown
                        size={11}
                        className="text-muted-foreground shrink-0"
                      />
                    ) : (
                      <ChevronRight
                        size={11}
                        className="text-muted-foreground shrink-0"
                      />
                    )}
                    <FileStatusIcon status={f.status} />
                    <span className="truncate flex-1">{f.path}</span>
                    {f.linesAdded > 0 && (
                      <span className="text-emerald-500 tabular-nums">
                        +{f.linesAdded}
                      </span>
                    )}
                    {f.linesRemoved > 0 && (
                      <span className="text-destructive tabular-nums">
                        -{f.linesRemoved}
                      </span>
                    )}
                  </button>
                  {open && (
                    <FileDiffViewer
                      slug={slug}
                      hash={commit.hash}
                      path={f.path}
                    />
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      ) : (
        <div className="text-[11px] text-muted-foreground">
          {t('drawer.commits.noDiffstat')}
        </div>
      )}
      <a
        href={d.url}
        onClick={(e) => {
          e.preventDefault()
          window.open(d.url, '_blank')
        }}
        className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1 underline-offset-2 hover:underline"
      >
        {t('drawer.commits.openOnBitbucket')} <ExternalLink size={10} />
      </a>
    </>
  )
}

/**
 * Inline-просмотр unified-diff одного файла. Подсветка по
 * первому символу строки: + emerald, - destructive, @@ sky,
 * остальное — base. Ничего не парсим — один проход по
 * .split('\n'). Pre-обёртка с max-height и собственным
 * горизонтальным скроллом, чтобы длинные строки не ломали layout.
 */
function FileDiffViewer({ slug, hash, path }) {
  const t = useT()
  const { data, isLoading, isError } = useCommitFileDiff(
    slug,
    hash,
    path,
    { enabled: true }
  )
  if (isLoading) {
    return (
      <div className="py-2 pl-5 text-[11px] text-muted-foreground inline-flex items-center gap-2">
        <Loader2 size={11} className="animate-spin" />{' '}
        {t('drawer.commits.loadingDiff')}
      </div>
    )
  }
  if (isError) {
    return (
      <div className="py-2 pl-5 text-[11px] text-destructive">
        {t('drawer.commits.cantLoadDiff')}
      </div>
    )
  }
  if (!data || !data.trim()) {
    return (
      <div className="py-2 pl-5 text-[11px] text-muted-foreground">
        {t('drawer.commits.diffEmpty')}
      </div>
    )
  }
  const lines = data.split('\n')
  return (
    <pre className="ml-5 mt-1 mb-2 max-h-96 overflow-auto bg-background/80 border border-border/40 rounded text-[11px] leading-snug">
      <code className="block">
        {lines.map((line, idx) => (
          <DiffLine key={idx} line={line} />
        ))}
      </code>
    </pre>
  )
}

function DiffLine({ line }) {
  let cls = 'text-foreground/80'
  if (line.startsWith('+++') || line.startsWith('---')) {
    cls = 'text-muted-foreground'
  } else if (line.startsWith('@@')) {
    cls = 'text-sky-400 bg-sky-500/10'
  } else if (line.startsWith('+')) {
    cls = 'text-emerald-400 bg-emerald-500/10'
  } else if (line.startsWith('-')) {
    cls = 'text-destructive bg-destructive/10'
  } else if (line.startsWith('diff ') || line.startsWith('index ')) {
    cls = 'text-muted-foreground'
  }
  return (
    <span className={cn('block whitespace-pre px-2', cls)}>{line || ' '}</span>
  )
}

function FileStatusIcon({ status }) {
  // Bitbucket diffstat statuses: added, removed, modified, renamed
  const map = {
    added: { ch: 'A', cls: 'text-emerald-500' },
    removed: { ch: 'D', cls: 'text-destructive' },
    modified: { ch: 'M', cls: 'text-sky-500' },
    renamed: { ch: 'R', cls: 'text-amber-500' }
  }
  const m = map[status] || { ch: '·', cls: 'text-muted-foreground' }
  return (
    <span
      title={status}
      className={cn(
        'inline-block w-4 text-center text-[10px] font-bold',
        m.cls
      )}
    >
      {m.ch}
    </span>
  )
}

/**
 * Pipelines-таб: 20 последних пайплайнов. Auto-poll каждые 15с
 * включается на уровне хука usePipelines когда есть IN_PROGRESS /
 * PENDING запись. Steps конкретного пайплайна грузятся лениво по
 * раскрытию.
 */
function PipelinesTab({ project, branch }) {
  const t = useT()
  const slug = project.slug
  const { data, isLoading, isError, refetch } = usePipelines(slug, {
    pagelen: 20,
    branch
  })
  const [expandedUuid, setExpandedUuid] = useState(null)

  const toggle = (uuid) =>
    setExpandedUuid((prev) => (prev === uuid ? null : uuid))

  if (isLoading) {
    return (
      <div className="p-6 space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="space-y-1.5">
            <div className="h-3 bg-muted rounded w-1/2 animate-pulse" />
            <div className="h-3 bg-muted rounded w-1/3 animate-pulse" />
          </div>
        ))}
      </div>
    )
  }
  if (isError) {
    return <TabErrorState onRetry={refetch} />
  }
  if (!data || data.length === 0) {
    return (
      <div className="p-6 text-sm text-muted-foreground space-y-2">
        <p>
          {branch
            ? t('drawer.pipelines.emptyOnBranch', { branch })
            : t('drawer.pipelines.empty') + '.'}
        </p>
        <p className="text-xs">{t('drawer.pipelines.scopeHint')}</p>
      </div>
    )
  }
  return (
    <div className="divide-y divide-border/60">
      {data.map((p) => (
        <PipelineRow
          key={p.uuid}
          slug={slug}
          pipeline={p}
          expanded={expandedUuid === p.uuid}
          onToggle={() => toggle(p.uuid)}
        />
      ))}
    </div>
  )
}

/**
 * Tasks-таб: незакрытые таски Jira-проекта, имя которого
 * префиксом совпадает с этим slug'ом. Если совпадения нет —
 * показываем сообщение и линк на My Tasks (там видны все
 * доступные).
 *
 * Каждая строка — accordion: клик раскрывает inline-detail c
 * description, последними 5 комментами, полями (assignee, status и
 * т.п.). Для тасков, у которых в title упомянут другой slug,
 * показываем бейдж slug-mismatch с tooltip — это та самая ситуация
 * "таск создан в одном проекте, а по факту относится к другому".
 */
function TasksTab({ project, initialIssue }) {
  const t = useT()
  const slug = project.slug
  const { project: matchedJira, isLoading: projectsLoading } =
    useJiraProjectForSlug(slug)
  const { projects: allBitbucketProjects } = useProjects()
  const knownSlugs = useMemo(
    () => (allBitbucketProjects || []).map((p) => p.slug),
    [allBitbucketProjects]
  )
  const openIssuesQuery = useProjectJiraIssues(matchedJira?.key, {
    enabled: !!matchedJira
  })
  // useMyJiraIssues — общий по всем проектам кэш (тот же что в My
  // Tasks page). Фильтруем клиентом по project.key чтобы получить
  // мои таски именно этого проекта без отдельного API-вызова.
  const myIssuesQuery = useMyJiraIssues({ maxResults: 100 })
  const closedIssuesQuery = useProjectClosedJiraIssues(matchedJira?.key, {
    enabled: !!matchedJira
  })
  const [expandedKey, setExpandedKey] = useState(initialIssue || null)
  const [showClosed, setShowClosed] = useState(false)

  // Группировка: my / others / done. Mine берём из useMyJiraIssues
  // (фильтр по project.key); остальные открытые — это
  // openIssuesQuery без mine; done — отдельный запрос на 10
  // последних. Mine pinned сверху, потому что это "что мне делать".
  const groups = useMemo(() => {
    const open = openIssuesQuery.data?.issues || []
    const mineGlobal = myIssuesQuery.data?.issues || []
    const mineForProject = matchedJira
      ? mineGlobal.filter((i) => i.project?.key === matchedJira.key)
      : []
    const myKeys = new Set(mineForProject.map((i) => i.key))
    const others = open.filter((i) => !myKeys.has(i.key))
    return {
      mine: mineForProject,
      others,
      done: closedIssuesQuery.data?.issues || []
    }
  }, [
    openIssuesQuery.data,
    myIssuesQuery.data,
    closedIssuesQuery.data,
    matchedJira
  ])

  if (projectsLoading) {
    return (
      <div className="p-6 text-xs text-muted-foreground inline-flex items-center gap-2">
        <Loader2 size={12} className="animate-spin" />{' '}
        {t('tasks.projectTab.resolving')}
      </div>
    )
  }
  if (!matchedJira) {
    return (
      <div className="p-6 text-sm text-muted-foreground space-y-2 max-w-md">
        <p>{t('tasks.projectTab.noMatch.message', { slug })}</p>
        <p className="text-xs">{t('tasks.projectTab.noMatch.hint')}</p>
      </div>
    )
  }
  if (openIssuesQuery.isLoading) {
    return (
      <div className="p-6 space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="space-y-1.5">
            <div className="h-3 bg-muted rounded w-3/4 animate-pulse" />
            <div className="h-3 bg-muted rounded w-1/2 animate-pulse" />
          </div>
        ))}
      </div>
    )
  }
  if (openIssuesQuery.isError) {
    return <TabErrorState onRetry={openIssuesQuery.refetch} />
  }

  const onToggle = (k) =>
    setExpandedKey((prev) => (prev === k ? null : k))
  const renderRow = (it) => (
    <TaskRowExpandable
      key={it.key}
      issue={it}
      currentSlug={slug}
      knownSlugs={knownSlugs}
      expanded={expandedKey === it.key}
      onToggle={() => onToggle(it.key)}
    />
  )

  const totalVisible =
    groups.mine.length +
    groups.others.length +
    (showClosed ? groups.done.length : 0)
  const noOpen = groups.mine.length === 0 && groups.others.length === 0

  return (
    <div>
      <div className="px-6 py-2 text-[11px] text-muted-foreground border-b border-border/40 bg-muted/10">
        {t('tasks.projectTab.linkedProject')}{' '}
        <code className="font-mono text-foreground/80">
          {matchedJira.key}
        </code>{' '}
        — {matchedJira.name}
      </div>

      {noOpen && (
        <div className="px-6 py-4 text-sm text-muted-foreground">
          {t('tasks.projectTab.noOpenInProject')}
        </div>
      )}

      {groups.mine.length > 0 && (
        <TaskGroup
          label={t('tasks.projectTab.assignedToYou')}
          accentCls="text-sky-300"
          count={groups.mine.length}
        >
          {groups.mine.map(renderRow)}
        </TaskGroup>
      )}

      {groups.others.length > 0 && (
        <TaskGroup
          label={t('tasks.projectTab.otherOpen')}
          accentCls="text-muted-foreground"
          count={groups.others.length}
        >
          {groups.others.map(renderRow)}
        </TaskGroup>
      )}

      {groups.done.length > 0 && (
        <div>
          <button
            onClick={() => setShowClosed((v) => !v)}
            className="w-full text-left px-6 py-2 text-[11px] uppercase tracking-wide text-muted-foreground bg-muted/10 border-y border-border/40 flex items-center gap-2 hover:bg-muted/20 transition-colors"
          >
            {showClosed ? (
              <ChevronDown size={11} />
            ) : (
              <ChevronRight size={11} />
            )}
            <span>{t('tasks.projectTab.recentlyDone')}</span>
            <span className="text-[10px] tabular-nums">
              ({groups.done.length})
            </span>
          </button>
          {showClosed && (
            <div className="divide-y divide-border/60 opacity-80">
              {groups.done.map(renderRow)}
            </div>
          )}
        </div>
      )}

      {totalVisible === 0 && groups.done.length > 0 && !showClosed && (
        <div className="px-6 py-2 text-[11px] text-muted-foreground">
          {t('tasks.projectTab.closedHidden', {
            count: groups.done.length
          })}
        </div>
      )}
    </div>
  )
}

/**
 * Заголовок-разделитель группы тасков. Просто sticky-style
 * uppercase плашка с подсчётом, под ней дети (строки тасков).
 */
function TaskGroup({ label, accentCls, count, children }) {
  return (
    <div>
      <div
        className={cn(
          'px-6 py-2 text-[11px] uppercase tracking-wide bg-muted/10 border-y border-border/40 flex items-center gap-2',
          accentCls
        )}
      >
        <span>{label}</span>
        <span className="text-[10px] tabular-nums opacity-80">
          ({count})
        </span>
      </div>
      <div className="divide-y divide-border/60">{children}</div>
    </div>
  )
}

function TaskRowExpandable({
  issue,
  currentSlug,
  knownSlugs,
  expanded,
  onToggle
}) {
  const t = useT()
  const detail = useJiraIssueDetail(issue.key, { enabled: expanded })
  const Caret = expanded ? ChevronDown : ChevronRight
  const mismatched = useMemo(() => {
    const all = findSlugMentions(issue.summary || '', knownSlugs)
    return all.filter(
      (s) => s.toLowerCase() !== currentSlug.toLowerCase()
    )
  }, [issue.summary, knownSlugs, currentSlug])

  // Дедлайн: amber если просрочен (для активных категорий — для
  // done не подсвечиваем, не имеет смысла).
  const dueOverdue =
    issue.duedate &&
    issue.statusCategory !== 'done' &&
    new Date(issue.duedate).getTime() < Date.now()

  return (
    <div>
      <button
        onClick={onToggle}
        className="w-full text-left px-6 py-2 flex items-center gap-2.5 hover:bg-accent/40 transition-colors"
      >
        <Caret size={14} className="shrink-0 text-muted-foreground" />
        {issue.issueTypeIconUrl && (
          <img
            src={issue.issueTypeIconUrl}
            alt={issue.issueType}
            title={issue.issueType}
            className="w-4 h-4 shrink-0"
          />
        )}
        <code className="text-[10px] font-mono shrink-0 text-muted-foreground tabular-nums">
          {issue.key}
        </code>
        <span className="text-sm flex-1 min-w-0 truncate">
          {issue.summary || t('drawer.commits.noMessage')}
        </span>
        {mismatched.length > 0 && (
          <SlugMismatchBadge mentioned={mismatched} />
        )}
        {issue.assignee ? (
          <span
            title={`Assignee: ${issue.assignee.displayName}`}
            className="shrink-0"
          >
            <Avatar name={issue.assignee.displayName} size={18} />
          </span>
        ) : (
          <span
            title="Unassigned"
            className="shrink-0 inline-flex items-center justify-center w-[18px] h-[18px] rounded-full bg-muted/40 text-muted-foreground text-[9px]"
          >
            ?
          </span>
        )}
        {issue.duedate && (
          <span
            title={`Due ${issue.duedate}`}
            className={cn(
              'shrink-0 text-[10px] inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded',
              dueOverdue
                ? 'bg-destructive/15 text-destructive'
                : 'bg-muted/40 text-muted-foreground'
            )}
          >
            <Calendar size={9} />
            {issue.duedate}
          </span>
        )}
        <StatusBadge
          category={issue.statusCategory}
          label={issue.status}
        />
        <span className="text-[11px] text-muted-foreground shrink-0 tabular-nums">
          {formatRelative(issue.updated)}
        </span>
      </button>
      {expanded && (
        <div className="px-6 pb-4 pl-[2.25rem] bg-muted/20 space-y-3 text-sm">
          <TaskDetailContent issueKey={issue.key} detail={detail} />
          <OpenInJiraLink issueKey={issue.key} />
        </div>
      )}
    </div>
  )
}

function PipelineRow({ slug, pipeline, expanded, onToggle }) {
  const t = useT()
  const Caret = expanded ? ChevronDown : ChevronRight
  return (
    <div>
      <button
        onClick={onToggle}
        className="w-full text-left px-6 py-2.5 flex items-center gap-3 hover:bg-accent/40 transition-colors"
      >
        <Caret size={14} className="shrink-0 text-muted-foreground" />
        <PipelineStateBadge state={pipeline.state} />
        <span className="font-mono text-xs shrink-0 tabular-nums">
          #{pipeline.buildNumber}
        </span>
        <div className="flex-1 min-w-0 flex items-center gap-2">
          {pipeline.branch && (
            <code className="text-xs truncate text-foreground/80">
              {pipeline.branch}
            </code>
          )}
        </div>
        <div className="text-[11px] text-muted-foreground tabular-nums shrink-0 hidden sm:block">
          {formatDuration(pipeline.durationSeconds)}
        </div>
        <div className="text-[11px] text-muted-foreground shrink-0">
          {formatRelative(pipeline.createdOn)}
        </div>
      </button>
      {expanded && (
        <div className="px-6 pb-4 pl-[2.25rem] bg-muted/20 space-y-2.5">
          <div className="text-[11px] text-muted-foreground flex items-center gap-2 flex-wrap">
            <span>by {pipeline.author}</span>
            {pipeline.commitHash && (
              <>
                <span>·</span>
                <code className="text-[10px]">
                  {pipeline.commitHash.slice(0, 7)}
                </code>
              </>
            )}
          </div>
          <PipelineSteps slug={slug} pipelineUuid={pipeline.uuid} />
          <a
            href={pipeline.url}
            onClick={(e) => {
              e.preventDefault()
              window.open(pipeline.url, '_blank')
            }}
            className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1 underline-offset-2 hover:underline"
          >
            {t('drawer.commits.openOnBitbucket')}{' '}
            <ExternalLink size={10} />
          </a>
        </div>
      )}
    </div>
  )
}

function PipelineSteps({ slug, pipelineUuid }) {
  const t = useT()
  const { data, isLoading, isError } = usePipelineSteps(slug, pipelineUuid)
  // Раскрытый step — для inline-log. Только один открыт за раз.
  const [openedStepUuid, setOpenedStepUuid] = useState(null)

  if (isLoading) {
    return (
      <div className="text-[11px] text-muted-foreground inline-flex items-center gap-2">
        <Loader2 size={12} className="animate-spin" />{' '}
        {t('drawer.pipelines.loadingSteps')}
      </div>
    )
  }
  if (isError) {
    return (
      <div className="text-[11px] text-destructive">
        {t('drawer.pipelines.cantLoadSteps')}
      </div>
    )
  }
  if (!data || data.length === 0) {
    return (
      <div className="text-[11px] text-muted-foreground">
        {t('drawer.pipelines.noSteps')}
      </div>
    )
  }
  return (
    <ul className="text-xs space-y-1">
      {data.map((s) => {
        const open = openedStepUuid === s.uuid
        // Лог пока активного step'а пока не стримим — пусть
        // пользователь подождёт завершения. Раскрывать таких
        // тоже не разрешаем, чтобы не отдавать пустой "no log
        // yet" каждый раз.
        const liveStep =
          s.state === 'IN_PROGRESS' ||
          s.state === 'PENDING' ||
          s.state === 'PAUSED'
        return (
          <li key={s.uuid}>
            <button
              onClick={() =>
                liveStep
                  ? null
                  : setOpenedStepUuid(open ? null : s.uuid)
              }
              disabled={liveStep}
              title={
                liveStep
                  ? t('drawer.pipelines.stepLogPending')
                  : open
                  ? t('drawer.pipelines.hideLog')
                  : t('drawer.pipelines.showLog')
              }
              className={cn(
                'w-full flex items-center gap-2 px-1 -mx-1 rounded text-left transition-colors',
                liveStep
                  ? 'cursor-default opacity-90'
                  : open
                  ? 'bg-accent/40'
                  : 'hover:bg-accent/30'
              )}
            >
              {!liveStep &&
                (open ? (
                  <ChevronDown
                    size={11}
                    className="text-muted-foreground shrink-0"
                  />
                ) : (
                  <ChevronRight
                    size={11}
                    className="text-muted-foreground shrink-0"
                  />
                ))}
              <PipelineStateBadge state={s.state} compact />
              <span className="flex-1 truncate">{s.name}</span>
              <span className="text-[11px] text-muted-foreground tabular-nums">
                {formatDuration(s.durationSeconds)}
              </span>
            </button>
            {open && !liveStep && (
              <StepLogViewer
                slug={slug}
                pipelineUuid={pipelineUuid}
                stepUuid={s.uuid}
              />
            )}
          </li>
        )
      })}
    </ul>
  )
}

function StepLogViewer({ slug, pipelineUuid, stepUuid }) {
  const t = useT()
  const { data, isLoading, isError } = usePipelineStepLog(
    slug,
    pipelineUuid,
    stepUuid,
    { enabled: true }
  )
  if (isLoading) {
    return (
      <div className="py-2 pl-5 text-[11px] text-muted-foreground inline-flex items-center gap-2">
        <Loader2 size={11} className="animate-spin" />{' '}
        {t('drawer.pipelines.loadingLog')}
      </div>
    )
  }
  if (isError) {
    return (
      <div className="py-2 pl-5 text-[11px] text-destructive">
        {t('drawer.pipelines.cantLoadLog')}
      </div>
    )
  }
  if (!data || !data.trim()) {
    return (
      <div className="py-2 pl-5 text-[11px] text-muted-foreground">
        {t('drawer.pipelines.emptyLog')}
      </div>
    )
  }
  return (
    <pre className="ml-5 mt-1 mb-2 max-h-96 overflow-auto bg-zinc-950 border border-border/40 rounded text-[11px] leading-snug text-zinc-200 px-2 py-1.5 whitespace-pre">
      {data}
    </pre>
  )
}

/**
 * Унифицированный бейдж статуса для пайплайнов и шагов. Цвет +
 * иконка + (опц) текст. Используется в drawer'е и на главной
 * (там — без текста, только точка с tooltip).
 */
export function PipelineStateBadge({ state, compact, dotOnly }) {
  const t = useT()
  const cfg = pipelineStateConfig(state)
  const label = cfg.labelKey ? t(cfg.labelKey) : cfg.label
  if (dotOnly) {
    return (
      <span
        title={label}
        className={cn(
          'inline-block w-2 h-2 rounded-full',
          cfg.dotCls,
          cfg.pulse && 'animate-pulse-soft'
        )}
      />
    )
  }
  const Icon = cfg.icon
  return (
    <span
      title={label}
      className={cn(
        'inline-flex items-center gap-1 shrink-0',
        compact ? 'text-[11px]' : 'text-xs',
        cfg.cls
      )}
    >
      <Icon
        size={compact ? 11 : 13}
        className={cfg.pulse ? 'animate-pulse' : ''}
      />
      {!compact && <span>{label}</span>}
    </span>
  )
}

function pipelineStateConfig(state) {
  switch (state) {
    case 'SUCCESSFUL':
      return {
        labelKey: 'drawer.pipelineState.successful',
        icon: CheckCircle2,
        cls: 'text-emerald-500',
        dotCls: 'bg-emerald-500'
      }
    case 'FAILED':
    case 'ERROR':
      return {
        labelKey:
          state === 'ERROR'
            ? 'drawer.pipelineState.error'
            : 'drawer.pipelineState.failed',
        icon: XCircle,
        cls: 'text-destructive',
        dotCls: 'bg-destructive'
      }
    case 'IN_PROGRESS':
      return {
        labelKey: 'drawer.pipelineState.inProgress',
        icon: Loader2,
        cls: 'text-sky-400',
        dotCls: 'bg-sky-500',
        pulse: true
      }
    case 'PAUSED':
      return {
        labelKey: 'drawer.pipelineState.paused',
        icon: Pause,
        cls: 'text-amber-500',
        dotCls: 'bg-amber-500'
      }
    case 'PENDING':
      return {
        labelKey: 'drawer.pipelineState.pending',
        icon: Clock,
        cls: 'text-amber-400',
        dotCls: 'bg-amber-400',
        pulse: true
      }
    case 'STOPPED':
      return {
        labelKey: 'drawer.pipelineState.stopped',
        icon: CircleSlash,
        cls: 'text-muted-foreground',
        dotCls: 'bg-zinc-500'
      }
    case 'EXPIRED':
      return {
        labelKey: 'drawer.pipelineState.expired',
        icon: Clock,
        cls: 'text-muted-foreground',
        dotCls: 'bg-zinc-500'
      }
    case 'HALTED':
      return {
        labelKey: 'drawer.pipelineState.halted',
        icon: AlertCircle,
        cls: 'text-amber-500',
        dotCls: 'bg-amber-500'
      }
    default:
      return {
        // Неизвестное состояние — даём raw статус как label,
        // т.к. в i18n его не предсказать.
        label: state || 'Unknown',
        icon: CircleDashed,
        cls: 'text-muted-foreground',
        dotCls: 'bg-zinc-600'
      }
  }
}

/**
 * Selector ветки для Commits/Pipelines табов. Native <select> —
 * простой, accessible, не нуждается ни в каких popover-зависимостях.
 * Опция "All branches" (value="") = null в state, тогда хуки идут
 * без branch-фильтра.
 *
 * Inline-стиль: ничего своего вокруг (ни padding'а, ни border'а),
 * чтобы родительский TabActionBar мог разложить его как один из
 * элементов своей полосы.
 */
function BranchPicker({ branchesQuery, value, onChange }) {
  const t = useT()
  const branches = branchesQuery.data?.branches || []
  const defaultBranch = branchesQuery.data?.defaultBranch || null
  const loading = branchesQuery.isLoading
  // Если выбрана ветка, которой ещё нет в списке (например пока
  // грузится /refs/branches), всё равно показываем её как option,
  // чтобы select не сбросило в "All branches" визуально.
  const showOrphan = value && !branches.includes(value)
  return (
    <div className="inline-flex items-center gap-2">
      <span className="text-muted-foreground shrink-0">
        {t('drawer.branch.label')}
      </span>
      <select
        value={value || ''}
        onChange={(e) => onChange(e.target.value || null)}
        disabled={loading}
        className={cn(
          'bg-background border border-input rounded px-2 py-1 text-xs font-mono',
          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
          'min-w-[10rem] max-w-[18rem] truncate',
          loading && 'opacity-60'
        )}
      >
        <option value="">{t('drawer.branch.all')}</option>
        {showOrphan && <option value={value}>{value}</option>}
        {branches.map((b) => (
          <option key={b} value={b}>
            {b}
            {b === defaultBranch ? t('drawer.branch.defaultSuffix') : ''}
          </option>
        ))}
      </select>
      {loading && (
        <Loader2 size={11} className="animate-spin text-muted-foreground" />
      )}
    </div>
  )
}

function TabErrorState({ onRetry }) {
  const t = useT()
  return (
    <SharedErrorState
      message={t('drawer.tab.errorState.message')}
      onRetry={onRetry}
      className="h-auto"
    />
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
  if (seconds == null || Number.isNaN(seconds)) return '—'
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  if (m < 60) return `${m}m ${String(s).padStart(2, '0')}s`
  const h = Math.floor(m / 60)
  const rm = m % 60
  return rm ? `${h}h ${rm}m` : `${h}h`
}


function BranchSwitcher({ slug, gitStatus, gitLoading, checkout, isRunning, onResult }) {
  const [open, setOpen] = useState(false)
  const [branches, setBranches] = useState(null)
  const [loadingBranches, setLoadingBranches] = useState(false)

  const branch = gitStatus?.branch || '?'
  const dirty = gitStatus?.dirty
  const ahead = gitStatus?.ahead || 0
  const behind = gitStatus?.behind || 0

  const openMenu = async () => {
    if (open) {
      setOpen(false)
      return
    }
    setOpen(true)
    if (branches) return
    setLoadingBranches(true)
    try {
      const list = await api.git.branches(slug)
      setBranches(list.all || [])
    } catch (e) {
      onResult?.(e?.message || String(e), 'error')
    } finally {
      setLoadingBranches(false)
    }
  }

  const onPick = async (b) => {
    setOpen(false)
    if (b === branch) return
    try {
      await checkout.mutateAsync(b)
      setBranches(null) // refresh next open
      onResult?.(`Checked out ${b}`, 'ok')
    } catch (e) {
      onResult?.(e?.message || String(e), 'error')
    }
  }

  if (gitLoading) {
    return (
      <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
        <Loader2 size={12} className="animate-spin" /> status…
      </span>
    )
  }

  return (
    <div className="relative">
      <button
        onClick={openMenu}
        disabled={isRunning || checkout.isPending}
        className={cn(
          'text-xs inline-flex items-center gap-2 px-2 py-1 rounded-md border border-input hover:bg-accent transition-colors',
          (isRunning || checkout.isPending) && 'opacity-60 cursor-not-allowed'
        )}
        title={
          isRunning
            ? 'Stop the running process before switching branches'
            : 'Switch branch'
        }
      >
        <code className="text-[11px]">{branch}</code>
        {dirty && <span className="text-amber-500">dirty</span>}
        {ahead > 0 && <span>↑{ahead}</span>}
        {behind > 0 && <span>↓{behind}</span>}
        {checkout.isPending && <Loader2 size={10} className="animate-spin" />}
      </button>
      {open && (
        <div
          className="absolute right-0 top-full mt-1 z-20 min-w-[180px] max-h-64 overflow-auto bg-popover border border-border rounded-md shadow-lg py-1 animate-in fade-in zoom-in-95 duration-150 origin-top-right"
          onMouseLeave={() => setOpen(false)}
        >
          {loadingBranches && (
            <div className="px-3 py-2 text-xs text-muted-foreground">
              <Loader2 size={12} className="animate-spin inline mr-1" />
              Loading…
            </div>
          )}
          {!loadingBranches &&
            branches &&
            branches.map((b) => (
              <button
                key={b}
                onClick={() => onPick(b)}
                className={cn(
                  'w-full text-left text-xs px-3 py-1.5 hover:bg-accent',
                  b === branch && 'bg-accent/50 font-medium'
                )}
              >
                <code>{b}</code>
                {b === branch && (
                  <span className="ml-2 text-muted-foreground">current</span>
                )}
              </button>
            ))}
          {!loadingBranches && branches && branches.length === 0 && (
            <div className="px-3 py-2 text-xs text-muted-foreground">
              No local branches
            </div>
          )}
        </div>
      )}
    </div>
  )
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

/**
 * Recent commits в Overview-табе. Использует тот же CommitRow что
 * и Commits-таб — единая семантика: клик по коммиту разворачивает
 * detail (diffstat, файлы с inline-diff'ом, "Open on Bitbucket").
 * Только один коммит раскрыт за раз. Для глубокого ныряния —
 * Commits-таб с 30 коммитами и branch picker'ом.
 */
function LastCommitSection({ slug }) {
  const t = useT()
  const { data, isLoading, isError } = useCommits(slug, 5)
  const [expandedHash, setExpandedHash] = useState(null)

  return (
    <div className="space-y-2">
      <div className="text-xs uppercase tracking-wide text-muted-foreground flex items-center gap-2 px-6">
        <GitCommit size={12} /> {t('drawer.lastCommit.title')}
      </div>
      {isLoading && (
        <div className="space-y-2 px-6">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="space-y-1.5">
              <div className="h-3 bg-muted rounded w-3/4 animate-pulse" />
              <div className="h-3 bg-muted rounded w-1/2 animate-pulse" />
            </div>
          ))}
        </div>
      )}
      {!isLoading && (isError || !data || data.length === 0) && (
        <div className="text-sm text-muted-foreground px-6">—</div>
      )}
      {!isLoading && data && data.length > 0 && (
        <div className="-mx-6 divide-y divide-border/60">
          {data.map((c) => (
            <CommitRow
              key={c.hash}
              slug={slug}
              commit={c}
              expanded={expandedHash === c.hash}
              onToggle={() =>
                setExpandedHash((prev) => (prev === c.hash ? null : c.hash))
              }
            />
          ))}
        </div>
      )}
    </div>
  )
}

function NotesSection({ value, onChange }) {
  const t = useT()
  return (
    <div className="space-y-2">
      <div className="text-xs uppercase tracking-wide text-muted-foreground flex items-center gap-2">
        <StickyNote size={12} /> {t('drawer.notes.title')}
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t('drawer.notes.placeholder')}
        rows={4}
        className="w-full bg-background border border-input rounded-md px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-y"
      />
      <p className="text-[10px] text-muted-foreground/70">
        {t('drawer.notes.localOnly')}
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
