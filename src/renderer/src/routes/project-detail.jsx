import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  X,
  ExternalLink,
  Code2,
  GitPullRequest,
  Play,
  Loader2,
  CheckCircle2,
  XCircle,
  CircleDashed,
  GitCommit
} from 'lucide-react'
import { useProjects } from '@/hooks/use-projects'
import { useLastCommit } from '@/hooks/use-last-commit'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { api } from '@/api'

export default function ProjectDetail() {
  const { slug } = useParams()
  const navigate = useNavigate()
  const { projects, isLoading: projectsLoading } = useProjects()
  const project = projects?.find((p) => p.slug === slug) || null

  if (projectsLoading) return <DrawerShell onClose={() => navigate('/projects')} loading />
  if (!project) return <DrawerNotFound slug={slug} onClose={() => navigate('/projects')} />

  return (
    <Drawer project={project} onClose={() => navigate('/projects')} />
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

function Drawer({ project, onClose }) {
  const cloned = project.local.cloned
  const [actionStatus, setActionStatus] = useState(null)

  const flash = (msg, kind = 'info') => {
    setActionStatus({ msg, kind })
    setTimeout(() => setActionStatus(null), 3500)
  }

  const onOpenVSCode = async () => {
    try {
      const res = await api.editor.openInVSCode(project.slug)
      flash(`Opened ${res?.opened ?? project.local.path} in VS Code`, 'ok')
    } catch (e) {
      flash(e?.message || String(e), 'error')
    }
  }

  const onPull = () => {
    flash('Pull is wired in the next checkpoint (simple-git).', 'info')
  }

  const onRun = () => {
    flash('Run is wired in the next checkpoint (process-manager).', 'info')
  }

  return (
    <div className="w-1/2 border-l border-border bg-background flex flex-col overflow-hidden">
      <header className="px-6 py-4 border-b border-border space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-base font-semibold font-mono">
                {project.slug}
              </h2>
              <a
                href={project.bitbucket.url}
                onClick={(e) => {
                  e.preventDefault()
                  // Внешние ссылки уже обработаны в main (setWindowOpenHandler);
                  // создаём временное окно, которое сразу деинит-открывает наружу.
                  window.open(project.bitbucket.url, '_blank')
                }}
                className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                title={project.bitbucket.url}
              >
                {project.bitbucket.projectKey || 'workspace'}/
                {project.slug}
                <ExternalLink size={11} />
              </a>
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
          <ActionButton
            icon={<Code2 />}
            onClick={onOpenVSCode}
            disabled={!cloned}
            disabledTooltip="Project is not cloned locally"
            label="Open in VS Code"
          />
          <ActionButton
            icon={<GitPullRequest />}
            onClick={onPull}
            disabled={!cloned}
            disabledTooltip="Project is not cloned locally"
            label="Pull"
          />
          <ActionButton
            icon={<Play />}
            onClick={onRun}
            disabled={!cloned}
            disabledTooltip="Project is not cloned locally"
            label="Run"
          />
        </div>
        {actionStatus && (
          <div
            className={
              'text-xs flex items-start gap-2 ' +
              (actionStatus.kind === 'error'
                ? 'text-destructive'
                : actionStatus.kind === 'ok'
                ? 'text-emerald-500'
                : 'text-muted-foreground')
            }
          >
            {actionStatus.kind === 'error' && (
              <XCircle size={14} className="mt-0.5 shrink-0" />
            )}
            {actionStatus.kind === 'ok' && (
              <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
            )}
            <div>{actionStatus.msg}</div>
          </div>
        )}
      </header>

      <div className="flex-1 overflow-auto p-6 space-y-4">
        <ChecklistRow
          state={project.local.cloned ? 'on' : 'off'}
          title={
            project.local.cloned
              ? 'Cloned'
              : 'Not cloned'
          }
          subtitle={
            project.local.cloned ? (
              <code className="text-xs">{project.local.path}</code>
            ) : (
              `Will live at ${project.local.path || '<projectsRoot>/' + project.slug.toLowerCase()}`
            )
          }
          right={
            project.local.cloned && (
              <span className="text-xs text-muted-foreground">
                Last pull: —
              </span>
            )
          }
        />
        <ChecklistRow
          state={project.db.exists ? 'on' : 'off'}
          title={
            project.db.exists
              ? `DB ${project.db.name} exists`
              : `DB ${project.db.name} not found`
          }
          subtitle={
            project.db.exists
              ? `Size: ${formatBytes(project.db.sizeBytes)}`
              : project.db.dumpPath
              ? `Dump available: ${project.db.dumpPath}`
              : 'No dump auto-detected'
          }
        />
        <ChecklistRow
          state={project.runtime.running ? 'running' : 'idle'}
          title={
            project.runtime.running
              ? `Running on :${project.runtime.port ?? '?'}`
              : 'Not running'
          }
          subtitle={
            project.runtime.running ? (
              <>
                PID {project.runtime.pid} · Started{' '}
                {formatRelative(project.runtime.startedAt)}
              </>
            ) : (
              '—'
            )
          }
        />

        {project.local.runnableSubpath !== undefined &&
          project.local.cloned && (
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
      </div>
    </div>
  )
}

function ActionButton({ icon, onClick, disabled, disabledTooltip, label }) {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onClick}
      disabled={disabled}
      title={disabled ? disabledTooltip : undefined}
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
      return <CircleDashed size={16} className={cls + ' text-muted-foreground'} />
    case 'idle':
    default:
      return <CircleDashed size={16} className={cls + ' text-muted-foreground/60'} />
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
