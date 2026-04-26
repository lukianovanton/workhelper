import { useEffect, useMemo, useState } from 'react'
import { Link, Outlet, useNavigate, useParams } from 'react-router-dom'
import {
  Loader2,
  RefreshCw,
  Settings as SettingsIcon,
  AlertCircle,
  AlertTriangle,
  Search,
  ChevronUp,
  ChevronDown,
  ExternalLink
} from 'lucide-react'
import { useProjects } from '@/hooks/use-projects'
import { useRunningProcesses } from '@/hooks/use-running-processes'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

const SORT_STORAGE_KEY = 'projects-sort'

const SORTABLE_COLUMNS = /** @type {const} */ ({
  slug: 'Slug',
  name: 'Name',
  dbSize: 'DB size',
  lastCommit: 'Last commit'
})

function loadSort() {
  try {
    const raw = localStorage.getItem(SORT_STORAGE_KEY)
    if (!raw) return { column: 'slug', direction: 'desc' }
    const parsed = JSON.parse(raw)
    if (
      typeof parsed?.column === 'string' &&
      parsed.column in SORTABLE_COLUMNS &&
      (parsed.direction === 'asc' || parsed.direction === 'desc')
    ) {
      return parsed
    }
  } catch {
    // fallthrough
  }
  return { column: 'slug', direction: 'desc' }
}

function saveSort(sort) {
  try {
    localStorage.setItem(SORT_STORAGE_KEY, JSON.stringify(sort))
  } catch {
    // localStorage может быть недоступен — игнорируем
  }
}

function compareProjects(a, b, column) {
  switch (column) {
    case 'slug':
      return a.slug.localeCompare(b.slug, undefined, { numeric: true })
    case 'name':
      return a.name.localeCompare(b.name, undefined, { numeric: true })
    case 'dbSize': {
      const av = a.db.sizeBytes ?? -1
      const bv = b.db.sizeBytes ?? -1
      return av - bv
    }
    case 'lastCommit': {
      const at = a.bitbucket.updatedOn
        ? new Date(a.bitbucket.updatedOn).getTime()
        : 0
      const bt = b.bitbucket.updatedOn
        ? new Date(b.bitbucket.updatedOn).getTime()
        : 0
      return at - bt
    }
    default:
      return 0
  }
}

const FILTERS = /** @type {const} */ ([
  { id: 'all', label: 'All' },
  { id: 'installed', label: 'Installed' },
  { id: 'not-installed', label: 'Not installed' },
  { id: 'running', label: 'Running' },
  { id: 'projects', label: 'Projects' },
  { id: 'templates', label: 'Templates' }
])

export default function ProjectsList() {
  const { projects, warnings, isLoading, isFetching, error, refresh } =
    useProjects()
  const { bySlug: runningBySlug } = useRunningProcesses()
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [sort, setSort] = useState(loadSort)
  const navigate = useNavigate()
  const { slug: openSlug } = useParams()

  useEffect(() => {
    saveSort(sort)
  }, [sort])

  const onSort = (column) => {
    setSort((prev) =>
      prev.column === column
        ? {
            column,
            direction: prev.direction === 'asc' ? 'desc' : 'asc'
          }
        : { column, direction: 'asc' }
    )
  }

  const sortedAndFiltered = useMemo(() => {
    if (!projects) return []
    const q = search.trim().toLowerCase()
    const filtered = projects.filter((p) => {
      switch (filter) {
        case 'installed':
          if (!p.local.cloned) return false
          break
        case 'not-installed':
          if (p.local.cloned) return false
          break
        case 'running':
          if (!runningBySlug.has(p.slug)) return false
          break
        case 'projects':
          if (p.kind !== 'project') return false
          break
        case 'templates':
          if (p.kind !== 'template') return false
          break
      }
      if (q) {
        const hay = `${p.slug} ${p.name} ${p.description || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })

    const sign = sort.direction === 'asc' ? 1 : -1
    return [...filtered].sort(
      (a, b) => compareProjects(a, b, sort.column) * sign
    )
  }, [projects, filter, search, runningBySlug, sort])

  const counts = useMemo(() => {
    if (!projects) return { all: 0 }
    return {
      all: projects.length,
      installed: projects.filter((p) => p.local.cloned).length,
      'not-installed': projects.filter((p) => !p.local.cloned).length,
      running: projects.filter((p) => runningBySlug.has(p.slug)).length,
      projects: projects.filter((p) => p.kind === 'project').length,
      templates: projects.filter((p) => p.kind === 'template').length
    }
  }, [projects, runningBySlug])

  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      await refresh()
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div className="flex h-screen w-screen">
      <aside className="w-60 border-r border-border bg-card flex flex-col">
        <div className="p-4 border-b border-border">
          <h1 className="text-lg font-semibold">Project Hub</h1>
          {projects && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {projects.length} repos in workspace
            </p>
          )}
        </div>
        <nav className="flex-1 p-3 space-y-1 text-sm overflow-y-auto">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={cn(
                'w-full text-left px-3 py-2 rounded-md flex items-center justify-between',
                filter === f.id
                  ? 'bg-accent text-accent-foreground'
                  : 'hover:bg-accent/60'
              )}
            >
              <span>{f.label}</span>
              <span className="text-xs text-muted-foreground">
                {counts[f.id] ?? 0}
              </span>
            </button>
          ))}
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
              placeholder="Search by slug, name, description…"
              className="pl-9"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={refreshing || isLoading}
          >
            {refreshing || isFetching ? (
              <Loader2 className="animate-spin" />
            ) : (
              <RefreshCw />
            )}
            Refresh
          </Button>
        </header>

        {warnings.length > 0 && <WarningBanner warnings={warnings} />}

        <div className="flex-1 overflow-auto">
          {isLoading && <ListLoading />}
          {error && <ListError error={error} />}
          {!isLoading && !error && projects && (
            <ProjectsTable
              projects={sortedAndFiltered}
              total={projects.length}
              openSlug={openSlug}
              runningBySlug={runningBySlug}
              sort={sort}
              onSort={onSort}
              onOpen={(slug) => navigate(`/projects/${slug}`)}
            />
          )}
        </div>
      </main>

      <Outlet />
    </div>
  )
}

function ProjectsTable({
  projects,
  total,
  openSlug,
  runningBySlug,
  sort,
  onSort,
  onOpen
}) {
  if (total === 0) {
    return (
      <EmptyState
        title="No repositories"
        message="Bitbucket workspace returned an empty list."
      />
    )
  }
  if (projects.length === 0) {
    return (
      <EmptyState
        title="No matches"
        message="Adjust filter or search to see results."
      />
    )
  }

  return (
    <table className="w-full text-sm">
      <thead className="sticky top-0 bg-background border-b border-border z-10">
        <tr className="text-left text-xs text-muted-foreground">
          <th className="font-normal px-4 py-2 w-20">Status</th>
          <SortHeader id="slug" sort={sort} onSort={onSort} className="w-32">
            Slug
          </SortHeader>
          <SortHeader id="name" sort={sort} onSort={onSort}>
            Name
          </SortHeader>
          <th className="font-normal px-4 py-2 w-24">Kind</th>
          <SortHeader
            id="dbSize"
            sort={sort}
            onSort={onSort}
            className="w-24"
            align="right"
          >
            DB size
          </SortHeader>
          <SortHeader
            id="lastCommit"
            sort={sort}
            onSort={onSort}
            className="w-32"
          >
            Last commit
          </SortHeader>
        </tr>
      </thead>
      <tbody>
        {projects.map((p) => (
          <tr
            key={p.slug}
            onClick={() => onOpen(p.slug)}
            className={cn(
              'border-b border-border/60 cursor-pointer hover:bg-accent/40',
              openSlug === p.slug && 'bg-accent/60'
            )}
          >
            <td className="px-4 py-2">
              <StatusDots
                project={p}
                runtime={runningBySlug.get(p.slug) || null}
              />
            </td>
            <td className="px-4 py-2 font-mono text-xs">{p.slug}</td>
            <td className="px-4 py-2">
              <div className="font-medium">{p.name}</div>
              {p.description && (
                <div className="text-xs text-muted-foreground line-clamp-1">
                  {p.description}
                </div>
              )}
            </td>
            <td className="px-4 py-2">
              <KindBadge kind={p.kind} projectKey={p.bitbucket.projectKey} />
            </td>
            <td className="px-4 py-2 text-right text-xs text-muted-foreground tabular-nums">
              {formatBytes(p.db.sizeBytes)}
            </td>
            <td className="px-4 py-2 text-xs text-muted-foreground">
              {formatRelative(p.bitbucket.updatedOn)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function SortHeader({ id, sort, onSort, children, className, align = 'left' }) {
  const active = sort.column === id
  const Arrow = sort.direction === 'asc' ? ChevronUp : ChevronDown
  return (
    <th className={cn('font-normal px-4 py-2', className)}>
      <button
        onClick={() => onSort(id)}
        className={cn(
          'inline-flex items-center gap-1 hover:text-foreground transition-colors',
          align === 'right' && 'justify-end w-full',
          active && 'text-foreground'
        )}
      >
        {align === 'right' && active && <Arrow size={12} />}
        {children}
        {align !== 'right' && active && <Arrow size={12} />}
      </button>
    </th>
  )
}

function StatusDots({ project, runtime }) {
  const running = !!runtime
  const dots = [
    {
      on: project.local.cloned,
      onColor: 'bg-emerald-500',
      offColor: 'bg-muted-foreground/25',
      title: project.local.cloned
        ? `Cloned at ${project.local.path}`
        : 'Not cloned'
    },
    {
      on: project.db.exists,
      onColor: 'bg-emerald-500',
      offColor: 'bg-muted-foreground/25',
      title: project.db.exists
        ? `Database ${project.db.name} exists`
        : `Database ${project.db.name} not found`
    },
    {
      on: false,
      onColor: 'bg-amber-500',
      offColor: 'bg-muted-foreground/15',
      title: 'Dirty (live status only in drawer for now)'
    },
    {
      on: running,
      onColor: 'bg-sky-500',
      offColor: 'bg-muted-foreground/15',
      title: running
        ? `Running on :${runtime?.port ?? '?'} (PID ${runtime?.pid})`
        : 'Not running'
    }
  ]
  return (
    <div className="flex gap-1 items-center">
      {dots.map((d, i) => (
        <span
          key={i}
          title={d.title}
          className={cn(
            'inline-block w-2 h-2 rounded-full',
            d.on ? d.onColor : d.offColor
          )}
        />
      ))}
      {running && runtime?.port != null && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            window.open(`http://localhost:${runtime.port}`, '_blank')
          }}
          title={`Open http://localhost:${runtime.port}`}
          className="ml-1 text-muted-foreground hover:text-sky-500 transition-colors"
        >
          <ExternalLink size={11} />
        </button>
      )}
    </div>
  )
}

function KindBadge({ kind, projectKey }) {
  const tone =
    kind === 'template'
      ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
      : 'bg-sky-500/15 text-sky-400 border-sky-500/30'
  return (
    <span
      title={projectKey ? `project.key = ${projectKey}` : ''}
      className={cn(
        'inline-flex items-center px-2 py-0.5 rounded-md text-xs border',
        tone
      )}
    >
      {kind}
    </span>
  )
}

function WarningBanner({ warnings }) {
  return (
    <div className="px-6 py-2 border-b border-amber-500/30 bg-amber-500/10 text-amber-400 text-xs flex items-start gap-2">
      <AlertTriangle size={14} className="mt-0.5 shrink-0" />
      <div className="space-y-0.5">
        {warnings.map((w, i) => (
          <div key={i}>{w}</div>
        ))}
      </div>
    </div>
  )
}

function ListLoading() {
  return (
    <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
      <Loader2 className="animate-spin mr-2" />
      Loading projects…
    </div>
  )
}

function ListError({ error }) {
  const message = error?.message || String(error)
  const isConfig =
    /credentials/i.test(message) || /workspace not set/i.test(message)
  return (
    <div className="h-full flex items-center justify-center p-8">
      <div className="max-w-md text-center space-y-3">
        <AlertCircle className="mx-auto text-destructive" size={32} />
        <h3 className="font-medium">Couldn't load projects</h3>
        <p className="text-sm text-muted-foreground">{message}</p>
        {isConfig && (
          <Link
            to="/settings"
            className="inline-flex items-center gap-2 text-sm text-primary underline-offset-4 hover:underline"
          >
            <SettingsIcon size={14} />
            Open Settings
          </Link>
        )}
      </div>
    </div>
  )
}

function EmptyState({ title, message }) {
  return (
    <div className="h-full flex items-center justify-center text-center p-8">
      <div>
        <h3 className="font-medium">{title}</h3>
        <p className="text-sm text-muted-foreground mt-1">{message}</p>
      </div>
    </div>
  )
}

function formatBytes(n) {
  if (n == null || Number.isNaN(n)) return '—'
  if (n === 0) return '0'
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
