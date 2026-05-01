import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Loader2,
  RefreshCw,
  Settings as SettingsIcon,
  Search,
  Star,
  List as ListIcon,
  ListTodo,
  ExternalLink,
  X as XIcon,
  ArrowLeftRight,
  AlertCircle
} from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useMyJiraIssues, useJiraIssueDetail } from '@/hooks/use-jira'
import { api } from '@/api'

/**
 * Page-уровень My Tasks — shows the user's open Jira issues across
 * all projects. Sidebar совпадает по структуре с projects-list (Workspace
 * раздел вверху, Settings внизу), чтобы пользователь мог легко
 * переключаться между списком репозиториев и тасками. Detail
 * (правая шторка) управляется локальным useState — ключ выбранной
 * задачи; не пишется в URL, чтобы не дёргать router-state на
 * каждый клик.
 */
export default function MyTasks() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data, isLoading, isError, error, refetch, isFetching } =
    useMyJiraIssues({ maxResults: 50 })
  const [search, setSearch] = useState('')
  const [openedKey, setOpenedKey] = useState(null)

  const issues = data?.issues || []

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return issues
    return issues.filter((it) => {
      const hay = `${it.key} ${it.summary} ${it.project.key} ${it.project.name}`.toLowerCase()
      return hay.includes(q)
    })
  }, [issues, search])

  const groups = useMemo(() => groupByStatusCategory(filtered), [filtered])

  return (
    <div className="flex h-screen w-screen">
      <aside className="w-60 border-r border-border bg-card flex flex-col">
        <div className="p-4 border-b border-border">
          <h1 className="text-lg font-semibold">Project Hub</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Tasks across all your Jira projects
          </p>
        </div>
        <nav className="flex-1 p-3 text-sm overflow-y-auto">
          <WorkspaceNav active="tasks" />
        </nav>
        <div className="p-3 border-t border-border">
          <Link
            to="/settings"
            className="flex items-center gap-2 px-3 py-2 rounded-md hover:bg-accent text-sm"
          >
            <SettingsIcon size={14} />
            Settings
          </Link>
        </div>
      </aside>

      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="px-6 py-4 border-b border-border flex items-center justify-between gap-4">
          <div className="flex-1 max-w-md relative">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter by key, summary, project…"
              className="pl-9"
            />
          </div>
          <div className="flex items-center gap-3 ml-auto">
            {data && (
              <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                {filtered.length === issues.length
                  ? `${issues.length} open`
                  : `${filtered.length} of ${issues.length}`}
              </span>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                queryClient.invalidateQueries({
                  queryKey: ['jira', 'my-issues']
                })
                refetch()
              }}
              disabled={isFetching}
            >
              {isFetching ? (
                <Loader2 className="animate-spin" />
              ) : (
                <RefreshCw />
              )}
              Refresh
            </Button>
          </div>
        </header>

        <div className="flex-1 overflow-auto">
          {isLoading && <ListSkeleton />}
          {isError && <ErrorState error={error} />}
          {!isLoading && !isError && issues.length === 0 && (
            <EmptyState
              title="No open tasks"
              message="Either you don't have any open issues assigned, or Jira credentials are not configured."
              cta={
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate('/settings')}
                >
                  <SettingsIcon size={14} /> Open Settings
                </Button>
              }
            />
          )}
          {!isLoading && !isError && issues.length > 0 && (
            <TaskGroups
              groups={groups}
              openedKey={openedKey}
              onOpen={setOpenedKey}
            />
          )}
        </div>
      </main>

      {openedKey && (
        <TaskDrawer
          issueKey={openedKey}
          onClose={() => setOpenedKey(null)}
        />
      )}
    </div>
  )
}

/**
 * Боковая навигация Workspace — общая для projects-list и my-tasks.
 * Активный пункт подсвечен. Используется в обеих страницах через
 * единственный prop active='projects'|'tasks'. Намеренно вынесена
 * экспортом — projects-list тоже её рендерит.
 */
export function WorkspaceNav({ active }) {
  return (
    <div className="space-y-1">
      <div className="px-3 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground/70">
        Workspace
      </div>
      <Link
        to="/projects"
        className={cn(
          'w-full text-left px-3 py-1.5 rounded-md flex items-center gap-2',
          active === 'projects'
            ? 'bg-accent text-accent-foreground'
            : 'hover:bg-accent/60 text-muted-foreground hover:text-foreground'
        )}
      >
        <ListIcon size={14} />
        <span>All projects</span>
      </Link>
      <Link
        to="/my-tasks"
        className={cn(
          'w-full text-left px-3 py-1.5 rounded-md flex items-center gap-2',
          active === 'tasks'
            ? 'bg-accent text-accent-foreground'
            : 'hover:bg-accent/60 text-muted-foreground hover:text-foreground'
        )}
      >
        <ListTodo size={14} />
        <span>My Tasks</span>
      </Link>
    </div>
  )
}

/**
 * Группирует таски по statusCategory: To Do / In Progress / Done.
 * "Done" в выдаче не должно быть (JQL фильтрует), но защититься
 * стоит — иногда бывают кастомные категории. Сохраняем порядок
 * To Do → In Progress → остальное.
 */
function groupByStatusCategory(issues) {
  const order = ['new', 'indeterminate', 'done', 'undefined']
  const buckets = new Map()
  for (const it of issues) {
    const key = it.statusCategory || 'undefined'
    if (!buckets.has(key)) {
      buckets.set(key, {
        key,
        label: it.statusCategoryName || labelFor(key),
        items: []
      })
    }
    buckets.get(key).items.push(it)
  }
  // Сортируем по фиксированному порядку, остальное в конец.
  return [...buckets.values()].sort((a, b) => {
    const ai = order.indexOf(a.key)
    const bi = order.indexOf(b.key)
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
  })
}

function labelFor(category) {
  switch (category) {
    case 'new':
      return 'To Do'
    case 'indeterminate':
      return 'In Progress'
    case 'done':
      return 'Done'
    default:
      return 'Other'
  }
}

function TaskGroups({ groups, openedKey, onOpen }) {
  if (groups.length === 0) {
    return (
      <EmptyState
        title="No matches"
        message="Filter narrowed the list to zero. Adjust the search box."
      />
    )
  }
  return (
    <div className="divide-y divide-border/60">
      {groups.map((g) => (
        <section key={g.key}>
          <div className="px-6 py-2 text-[11px] uppercase tracking-wide text-muted-foreground bg-muted/20">
            {g.label} <span className="tabular-nums">({g.items.length})</span>
          </div>
          {g.items.map((it) => (
            <TaskRow
              key={it.key}
              issue={it}
              opened={openedKey === it.key}
              onOpen={() => onOpen(it.key)}
            />
          ))}
        </section>
      ))}
    </div>
  )
}

function TaskRow({ issue, opened, onOpen }) {
  return (
    <button
      onClick={onOpen}
      className={cn(
        'w-full text-left px-6 py-2.5 flex items-center gap-3 transition-colors border-b border-border/40 last:border-b-0',
        opened ? 'bg-accent/60' : 'hover:bg-accent/40'
      )}
    >
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
        {issue.summary || '(no summary)'}
      </span>
      <code className="text-[10px] font-mono shrink-0 text-muted-foreground hidden sm:block">
        {issue.project.key}
      </code>
      {issue.priorityIconUrl && (
        <img
          src={issue.priorityIconUrl}
          alt={issue.priority || ''}
          title={issue.priority || ''}
          className="w-3.5 h-3.5 shrink-0"
        />
      )}
      <span className="text-[11px] text-muted-foreground shrink-0">
        {formatRelative(issue.updated)}
      </span>
    </button>
  )
}

/**
 * Правая шторка с деталью задачи. Lazy: useJiraIssueDetail enabled,
 * только когда issueKey установлен. Закрывается ✕ или Escape.
 */
function TaskDrawer({ issueKey, onClose }) {
  const detail = useJiraIssueDetail(issueKey)
  return (
    <aside className="w-1/2 border-l border-border bg-background flex flex-col animate-in slide-in-from-right-4 duration-200">
      <header className="px-6 py-4 border-b border-border flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-base font-mono font-semibold">
              {issueKey}
            </h2>
            <OpenInJiraLink issueKey={issueKey} />
          </div>
          {detail.data?.summary && (
            <div className="text-sm mt-1 text-foreground">
              {detail.data.summary}
            </div>
          )}
        </div>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <XIcon />
        </Button>
      </header>
      <div className="flex-1 overflow-auto p-6 space-y-4 text-sm">
        <TaskDetailContent detail={detail} />
      </div>
    </aside>
  )
}

export function TaskDetailContent({ detail }) {
  if (detail.isLoading) {
    return (
      <div className="text-xs text-muted-foreground inline-flex items-center gap-2">
        <Loader2 size={12} className="animate-spin" /> Loading…
      </div>
    )
  }
  if (detail.isError || !detail.data) {
    return (
      <div className="text-xs text-destructive">
        Could not load issue details.
      </div>
    )
  }
  const d = detail.data
  return (
    <>
      <div className="grid grid-cols-2 gap-3 text-xs">
        <Field label="Status">
          <StatusBadge category={d.statusCategory} label={d.status} />
        </Field>
        <Field label="Project">
          <span className="font-mono">{d.project.key}</span>{' '}
          <span className="text-muted-foreground">— {d.project.name}</span>
        </Field>
        <Field label="Assignee">
          {d.assignee ? d.assignee.displayName : '—'}
        </Field>
        <Field label="Reporter">
          {d.reporter ? d.reporter.displayName : '—'}
        </Field>
        <Field label="Priority">{d.priority || '—'}</Field>
        <Field label="Type">{d.issueType}</Field>
        <Field label="Updated">{formatRelative(d.updated)}</Field>
        <Field label="Created">{formatRelative(d.created)}</Field>
        {d.duedate && <Field label="Due">{d.duedate}</Field>}
        {d.labels.length > 0 && (
          <Field label="Labels" full>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {d.labels.map((l) => (
                <span
                  key={l}
                  className="text-[10px] px-1.5 py-0.5 rounded-sm bg-muted/50 font-mono"
                >
                  {l}
                </span>
              ))}
            </div>
          </Field>
        )}
      </div>

      {d.description && (
        <section className="space-y-2">
          <h3 className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Description
          </h3>
          <pre className="text-xs whitespace-pre-wrap font-sans bg-muted/30 border border-border/40 rounded px-3 py-2">
            {d.description}
          </pre>
        </section>
      )}

      {d.comments.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Comments ({d.comments.length})
          </h3>
          <ul className="space-y-3">
            {d.comments.map((c) => (
              <li
                key={c.id}
                className="border-l-2 border-border pl-3 space-y-1"
              >
                <div className="text-[11px] text-muted-foreground flex items-center gap-2">
                  <strong className="text-foreground/80">{c.author}</strong>
                  <span>·</span>
                  <span>{formatRelative(c.created)}</span>
                </div>
                <div className="text-xs whitespace-pre-wrap">{c.body}</div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  )
}

function Field({ label, children, full }) {
  return (
    <div className={cn(full && 'col-span-2')}>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
        {label}
      </div>
      <div className="mt-0.5">{children}</div>
    </div>
  )
}

export function StatusBadge({ category, label }) {
  const cfg = statusBadgeConfig(category)
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wide font-medium',
        cfg.cls
      )}
    >
      {label || cfg.fallback}
    </span>
  )
}

function statusBadgeConfig(category) {
  switch (category) {
    case 'new':
      return { fallback: 'To Do', cls: 'bg-zinc-700/40 text-zinc-300' }
    case 'indeterminate':
      return {
        fallback: 'In Progress',
        cls: 'bg-sky-500/20 text-sky-300'
      }
    case 'done':
      return {
        fallback: 'Done',
        cls: 'bg-emerald-500/20 text-emerald-300'
      }
    default:
      return {
        fallback: 'Status',
        cls: 'bg-muted/50 text-muted-foreground'
      }
  }
}

export function OpenInJiraLink({ issueKey, className }) {
  return (
    <button
      onClick={async () => {
        try {
          const url = await api.jira.issueUrl(issueKey)
          if (url) window.open(url, '_blank')
        } catch {
          // ignore
        }
      }}
      className={cn(
        'text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1 underline-offset-2 hover:underline',
        className
      )}
    >
      Open in Jira <ExternalLink size={10} />
    </button>
  )
}

function ListSkeleton() {
  return (
    <div className="p-6 space-y-3">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="space-y-1.5">
          <div className="h-3 bg-muted rounded w-1/2 animate-pulse" />
          <div className="h-3 bg-muted rounded w-1/3 animate-pulse" />
        </div>
      ))}
    </div>
  )
}

function ErrorState({ error }) {
  const msg = error?.message || String(error || 'Unknown error')
  const isConfig = /credentials|host|configured/i.test(msg)
  return (
    <div className="h-full flex items-center justify-center p-8">
      <div className="max-w-md text-center space-y-3">
        <AlertCircle className="mx-auto text-destructive" size={32} />
        <h3 className="font-medium">Couldn't load tasks</h3>
        <p className="text-sm text-muted-foreground">{msg}</p>
        {isConfig && (
          <Link
            to="/settings"
            className="inline-flex items-center gap-2 text-sm text-primary underline-offset-4 hover:underline"
          >
            <SettingsIcon size={14} /> Open Jira settings
          </Link>
        )}
      </div>
    </div>
  )
}

function EmptyState({ title, message, cta }) {
  return (
    <div className="h-full flex items-center justify-center text-center p-8">
      <div className="max-w-sm space-y-3">
        <ListTodo size={32} className="mx-auto text-muted-foreground/40" />
        <h3 className="font-medium">{title}</h3>
        <p className="text-sm text-muted-foreground">{message}</p>
        {cta}
      </div>
    </div>
  )
}

/**
 * Бейдж "slug mismatch" — экспортируется отдельно для использования
 * в Tasks-табе drawer'а проекта. Маленький предупредительный
 * элемент с tooltip какого slug'а упомянуто.
 */
export function SlugMismatchBadge({ mentioned }) {
  if (!mentioned || mentioned.length === 0) return null
  const tooltip = `Mentions ${mentioned.join(', ')} — different from the Jira project this task lives in`
  return (
    <span
      title={tooltip}
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-amber-500/15 text-amber-400 border border-amber-500/30"
    >
      <ArrowLeftRight size={9} />
      mismatch
    </span>
  )
}

function formatRelative(iso) {
  if (!iso) return '—'
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return '—'
  const diff = Date.now() - then
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
