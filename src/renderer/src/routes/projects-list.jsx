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
  ExternalLink,
  Star,
  Square,
  Package,
  FileCode2,
  GitPullRequest,
  XSquare
} from 'lucide-react'
import { useProjects } from '@/hooks/use-projects'
import { useRunningProcesses } from '@/hooks/use-running-processes'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useProjectsMetaStore } from '@/store/projects-meta.store.js'
import { usePrefsStore } from '@/store/prefs.store.js'
import { toast } from '@/store/toast.store.js'
import { Checkbox } from '@/components/ui/checkbox'
import { api } from '@/api'

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
  const favorites = useProjectsMetaStore((s) => s.favorites)
  const toggleFavorite = useProjectsMetaStore((s) => s.toggleFavorite)
  const recent = useProjectsMetaStore((s) => s.recent)
  const density = usePrefsStore((s) => s.density)
  const searchHighlight = usePrefsStore((s) => s.searchHighlight)
  // Multi-select filter: набор активных id. Пустой набор = «All».
  // ANDится между активными — например {installed, running} даёт
  // только running-installed.
  const [activeFilters, setActiveFilters] = useState(() => new Set())
  const toggleFilter = (id) => {
    setActiveFilters((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const clearFilters = () => setActiveFilters(new Set())
  const isFilterActive = (id) =>
    activeFilters.has(id) || (id === 'all' && activeFilters.size === 0)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(() => new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  const toggleSelected = (slug) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(slug)) next.delete(slug)
      else next.add(slug)
      return next
    })
  }
  const clearSelected = () => setSelected(new Set())
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
      if (activeFilters.size > 0) {
        if (activeFilters.has('installed') && !p.local.cloned) return false
        if (activeFilters.has('not-installed') && p.local.cloned) return false
        if (activeFilters.has('running') && !runningBySlug.has(p.slug))
          return false
        if (activeFilters.has('projects') && p.kind !== 'project')
          return false
        if (activeFilters.has('templates') && p.kind !== 'template')
          return false
      }
      if (q) {
        const hay = `${p.slug} ${p.name} ${p.description || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })

    const sign = sort.direction === 'asc' ? 1 : -1
    return [...filtered].sort((a, b) => {
      // Избранные всегда наверху, независимо от выбранной сортировки
      const aFav = !!favorites[a.slug]
      const bFav = !!favorites[b.slug]
      if (aFav !== bFav) return aFav ? -1 : 1
      return compareProjects(a, b, sort.column) * sign
    })
  }, [projects, activeFilters, search, runningBySlug, sort, favorites])

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

  // Bulk-операции. Параллельно через allSettled — не падаем
  // на первой ошибке. Один тост-summary в конце.
  const runBulk = async (action, slugs, label, fn) => {
    if (slugs.length === 0) return
    setBulkBusy(true)
    const id = toast.info(`${label} ${slugs.length} project(s)…`, {
      durationMs: 0
    })
    try {
      const results = await Promise.allSettled(slugs.map(fn))
      const ok = results.filter((r) => r.status === 'fulfilled').length
      const fail = results.length - ok
      toast.dismiss(id)
      if (fail === 0) {
        toast.ok(`${label}: ${ok}/${results.length} succeeded`)
      } else {
        const firstErr =
          results.find((r) => r.status === 'rejected')?.reason?.message ||
          'unknown'
        toast.error(
          `${label}: ${ok}/${results.length} succeeded, ${fail} failed (e.g. ${firstErr})`
        )
      }
      await refresh()
    } finally {
      setBulkBusy(false)
    }
  }

  const onBulkPull = () => {
    if (!projects) return
    const slugs = [...selected].filter((s) => {
      const p = projects.find((x) => x.slug === s)
      return p?.local.cloned && !runningBySlug.has(s)
    })
    runBulk('Pull', slugs, 'Pull', (slug) => api.git.pull(slug))
  }

  const onBulkStop = () => {
    const slugs = [...selected].filter((s) => runningBySlug.has(s))
    runBulk('Stop', slugs, 'Stop', (slug) => api.process.stop(slug))
  }

  const onPullAllInstalled = () => {
    if (!projects) return
    const slugs = projects
      .filter((p) => p.local.cloned && !runningBySlug.has(p.slug))
      .map((p) => p.slug)
    runBulk('Pull all', slugs, 'Pull', (slug) => api.git.pull(slug))
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
          {FILTERS.map((f) => {
            const active = isFilterActive(f.id)
            return (
              <button
                key={f.id}
                onClick={() =>
                  f.id === 'all' ? clearFilters() : toggleFilter(f.id)
                }
                className={cn(
                  'w-full text-left px-3 py-2 rounded-md flex items-center justify-between',
                  active
                    ? 'bg-accent text-accent-foreground'
                    : 'hover:bg-accent/60'
                )}
              >
                <span>{f.label}</span>
                <span className="text-xs text-muted-foreground">
                  {counts[f.id] ?? 0}
                </span>
              </button>
            )
          })}

          {recent.length > 0 && projects && (
            <div className="pt-3 mt-3 border-t border-border">
              <div className="px-3 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground/70">
                Recent
              </div>
              {recent.slice(0, 5).map((r) => {
                const p = projects.find((x) => x.slug === r.slug)
                if (!p) return null
                return (
                  <button
                    key={r.slug}
                    onClick={() => navigate(`/projects/${r.slug}`)}
                    className={cn(
                      'w-full text-left px-3 py-1.5 rounded-md flex items-center justify-between text-xs',
                      openSlug === r.slug
                        ? 'bg-accent text-accent-foreground'
                        : 'hover:bg-accent/60 text-muted-foreground hover:text-foreground'
                    )}
                  >
                    <span className="font-mono truncate">{r.slug}</span>
                    {runningBySlug.has(r.slug) && (
                      <span className="ml-2 inline-block w-1.5 h-1.5 rounded-full bg-sky-500 shrink-0" />
                    )}
                  </button>
                )
              })}
            </div>
          )}
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
            onClick={onPullAllInstalled}
            disabled={bulkBusy || isLoading || !projects}
            title="Pull on every installed project that isn't running"
          >
            {bulkBusy ? <Loader2 className="animate-spin" /> : <GitPullRequest />}
            Pull all
          </Button>
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

        {selected.size > 0 && (
          <div className="px-6 py-2 border-b border-amber-500/30 bg-amber-500/10 text-amber-300 text-xs flex items-center gap-3">
            <span>{selected.size} selected</span>
            <Button
              variant="outline"
              size="sm"
              onClick={onBulkPull}
              disabled={bulkBusy}
            >
              <GitPullRequest /> Pull
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={onBulkStop}
              disabled={bulkBusy}
            >
              <Square /> Stop
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={clearSelected}
              className="ml-auto"
            >
              <XSquare /> Clear
            </Button>
          </div>
        )}

        {warnings.length > 0 && <WarningBanner warnings={warnings} />}

        <RunningBar
          running={Array.from(runningBySlug.values())}
          onOpen={(slug) => navigate(`/projects/${slug}`)}
          onStop={async (slug) => {
            try {
              await api.process.stop(slug)
            } catch {
              // ignore
            }
          }}
        />

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
              favorites={favorites}
              toggleFavorite={toggleFavorite}
              density={density}
              search={searchHighlight ? search.trim() : ''}
              selected={selected}
              toggleSelected={toggleSelected}
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
  favorites,
  toggleFavorite,
  density,
  search,
  selected,
  toggleSelected,
  onOpen
}) {
  const compact = density === 'compact'
  const cellPad = compact ? 'px-3 py-1' : 'px-4 py-2'
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
          <th className={cn('font-normal w-8', cellPad)}></th>
          <th className={cn('font-normal w-8', cellPad)}></th>
          <th className={cn('font-normal w-20', cellPad)}>Status</th>
          <SortHeader id="slug" sort={sort} onSort={onSort} className={cn('w-32', cellPad)}>
            Slug
          </SortHeader>
          <SortHeader id="name" sort={sort} onSort={onSort} className={cellPad}>
            Name
          </SortHeader>
          <th className={cn('font-normal w-24', cellPad)}>Kind</th>
          <SortHeader
            id="dbSize"
            sort={sort}
            onSort={onSort}
            className={cn('w-24', cellPad)}
            align="right"
          >
            DB size
          </SortHeader>
          <SortHeader
            id="lastCommit"
            sort={sort}
            onSort={onSort}
            className={cn('w-32', cellPad)}
          >
            Last commit
          </SortHeader>
        </tr>
      </thead>
      <tbody>
        {projects.map((p) => {
          const fav = !!favorites[p.slug]
          return (
            <tr
              key={p.slug}
              onClick={() => onOpen(p.slug)}
              className={cn(
                'border-b border-border/60 cursor-pointer hover:bg-accent/40',
                openSlug === p.slug && 'bg-accent/60'
              )}
            >
              <td className={cn(cellPad, 'text-center')}>
                <Checkbox
                  checked={selected.has(p.slug)}
                  onCheckedChange={() => toggleSelected(p.slug)}
                  onClick={(e) => e.stopPropagation()}
                />
              </td>
              <td className={cn(cellPad, 'text-center')}>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleFavorite(p.slug)
                  }}
                  title={fav ? 'Unpin' : 'Pin to top'}
                  className={cn(
                    'transition-colors',
                    fav
                      ? 'text-amber-400 hover:text-amber-300'
                      : 'text-muted-foreground/30 hover:text-amber-400'
                  )}
                >
                  <Star
                    size={14}
                    className={fav ? 'fill-current' : ''}
                  />
                </button>
              </td>
              <td className={cellPad}>
                <StatusDots
                  project={p}
                  runtime={runningBySlug.get(p.slug) || null}
                />
              </td>
              <td className={cn(cellPad, 'font-mono text-xs')}>
                <Highlight text={p.slug} match={search} />
              </td>
              <td className={cellPad}>
                <div className="font-medium">
                  <Highlight text={p.name} match={search} />
                </div>
                {p.description && (
                  <div className="text-xs text-muted-foreground line-clamp-1">
                    <Highlight text={p.description} match={search} />
                  </div>
                )}
              </td>
              <td className={cellPad}>
                <KindBadge kind={p.kind} projectKey={p.bitbucket.projectKey} />
              </td>
              <td className={cn(cellPad, 'text-right text-xs text-muted-foreground tabular-nums')}>
                {formatBytes(p.db.sizeBytes)}
              </td>
              <td className={cn(cellPad, 'text-xs text-muted-foreground')}>
                {formatRelative(p.bitbucket.updatedOn)}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

/**
 * Подсветка совпадения с поисковой строкой. Case-insensitive,
 * только первое вхождение (для slug/name достаточно). Если match
 * пустой — рендерит исходный текст без обёрток.
 */
function Highlight({ text, match }) {
  if (!match || !text) return text || ''
  const idx = text.toLowerCase().indexOf(match.toLowerCase())
  if (idx === -1) return text
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-amber-400/30 text-foreground rounded-sm px-0.5">
        {text.slice(idx, idx + match.length)}
      </mark>
      {text.slice(idx + match.length)}
    </>
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
      pulse: running,
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
            d.on ? d.onColor : d.offColor,
            d.pulse && 'animate-pulse'
          )}
        />
      ))}
      {running && runtime?.url && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            window.open(runtime.url, '_blank')
          }}
          title={`Open ${runtime.url}`}
          className="ml-1 text-muted-foreground hover:text-sky-500 transition-colors"
        >
          <ExternalLink size={11} />
        </button>
      )}
    </div>
  )
}

function KindBadge({ kind, projectKey }) {
  const isTemplate = kind === 'template'
  const tone = isTemplate
    ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
    : 'bg-sky-500/15 text-sky-400 border-sky-500/30'
  const Icon = isTemplate ? FileCode2 : Package
  return (
    <span
      title={projectKey ? `project.key = ${projectKey}` : ''}
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs border',
        tone
      )}
    >
      <Icon size={11} />
      {kind}
    </span>
  )
}

/**
 * Sticky bar в шапке main-секции, виден когда есть хоть один
 * запущенный dotnet. Чипсы по проектам: клик по slug → drawer,
 * клик по :port → внешний браузер, клик по ✕ → stop.
 */
function RunningBar({ running, onOpen, onStop }) {
  if (!running || running.length === 0) return null
  return (
    <div className="px-6 py-2 border-b border-sky-500/30 bg-sky-500/10 flex items-center gap-2 flex-wrap text-xs">
      <span className="text-sky-400 font-medium">
        Running ({running.length}):
      </span>
      {running.map((r) => (
        <span
          key={r.slug}
          className="inline-flex items-center gap-1 rounded-md border border-sky-500/40 bg-sky-500/15 px-2 py-0.5"
        >
          <button
            onClick={() => onOpen(r.slug)}
            className="font-mono text-sky-300 hover:text-sky-100"
            title={`Open ${r.slug} drawer`}
          >
            {r.slug}
          </button>
          {r.url ? (
            <button
              onClick={(e) => {
                e.stopPropagation()
                window.open(r.url, '_blank')
              }}
              title={`Open ${r.url}`}
              className="text-sky-400 hover:text-sky-200"
            >
              :{r.port ?? '?'}
              <ExternalLink size={10} className="inline ml-0.5 -mt-0.5" />
            </button>
          ) : (
            <span className="text-muted-foreground">…</span>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation()
              onStop(r.slug)
            }}
            title="Stop"
            className="ml-1 text-muted-foreground hover:text-destructive"
          >
            <Square size={10} className="inline" />
          </button>
        </span>
      ))}
    </div>
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
  // Скелетон-строки вместо одинокого спиннера. Пользователь сразу видит,
  // что список вот-вот будет, и где он будет.
  return (
    <div className="w-full">
      {Array.from({ length: 12 }).map((_, i) => (
        <div
          key={i}
          className="border-b border-border/40 px-4 py-3 flex gap-4 animate-pulse"
          style={{ animationDelay: `${i * 50}ms` }}
        >
          <div className="w-8 h-3 bg-muted/40 rounded" />
          <div className="w-20 h-3 bg-muted/40 rounded" />
          <div className="w-32 h-3 bg-muted/40 rounded" />
          <div className="flex-1 h-3 bg-muted/40 rounded" />
          <div className="w-16 h-3 bg-muted/40 rounded" />
          <div className="w-20 h-3 bg-muted/40 rounded" />
        </div>
      ))}
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
