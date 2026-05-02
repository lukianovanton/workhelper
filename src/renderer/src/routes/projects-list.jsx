import { useEffect, useMemo, useRef, useState } from 'react'
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
  FileCode2,
  GitPullRequest,
  CheckSquare,
  Filter,
  X as XIcon,
  Users,
  ListTodo
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
import { usePresence } from '@/hooks/use-presence'
import { useBuilds } from '@/hooks/use-vcs'
import {
  useMyJiraIssues,
  parseSlugFromProjectName
} from '@/hooks/use-jira'
import { PipelineStateBadge } from '@/routes/project-detail'
import { WorkspaceNav } from '@/routes/my-tasks'
import { useT } from '@/i18n'
import { getVcsProvider } from '@/lib/vcs-providers'
import {
  EmptyState as SharedEmptyState,
  ErrorState as SharedErrorState
} from '@/components/states'
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

function compareProjects(a, b, column, taskCountBySlug) {
  switch (column) {
    case 'slug':
      return a.slug.localeCompare(b.slug, undefined, { numeric: true })
    case 'name':
      return a.name.localeCompare(b.name, undefined, { numeric: true })
    case 'source': {
      const an = a.source?.name || a.source?.type || ''
      const bn = b.source?.name || b.source?.type || ''
      return an.localeCompare(bn)
    }
    case 'tasks': {
      const at = taskCountBySlug?.get(a.slug) || 0
      const bt = taskCountBySlug?.get(b.slug) || 0
      return at - bt
    }
    case 'dbSize': {
      const av = a.db.sizeBytes ?? -1
      const bv = b.db.sizeBytes ?? -1
      return av - bv
    }
    case 'lastCommit': {
      const at = a.updatedOn
        ? new Date(a.updatedOn).getTime()
        : 0
      const bt = b.updatedOn
        ? new Date(b.updatedOn).getTime()
        : 0
      return at - bt
    }
    default:
      return 0
  }
}

// Sidebar разбит на два смысловых блока. Внутри одного блока — single
// select (выбираем «состояние установки» ИЛИ «тип репозитория»), между
// блоками тоже single select: ровно один активный фильтр на всю
// навигацию или null = All. Это сознательно, чтобы не было
// противоречивых комбинаций вроде Installed + Not installed.
const NAV_SECTIONS = /** @type {const} */ ([
  {
    titleKey: 'projects.nav.status',
    items: [
      { id: 'all', labelKey: 'projects.nav.all' },
      { id: 'installed', labelKey: 'projects.nav.installed' },
      { id: 'not-installed', labelKey: 'projects.nav.notInstalled' },
      { id: 'running', labelKey: 'projects.nav.running' }
    ]
  },
  {
    titleKey: 'projects.nav.type',
    items: [
      { id: 'projects', labelKey: 'projects.nav.projects' },
      { id: 'templates', labelKey: 'projects.nav.templates' }
    ]
  }
])

export default function ProjectsList() {
  const t = useT()
  const { projects, warnings, isLoading, isFetching, error, refresh } =
    useProjects()
  const { bySlug: runningBySlug } = useRunningProcesses()
  const favorites = useProjectsMetaStore((s) => s.favorites)
  const toggleFavorite = useProjectsMetaStore((s) => s.toggleFavorite)
  const recent = useProjectsMetaStore((s) => s.recent)
  const density = usePrefsStore((s) => s.density)
  const searchHighlight = usePrefsStore((s) => s.searchHighlight)
  // Single-select filter: либо null (= All), либо ровно один id.
  // Multi-select не нужен — комбинация Installed + Not installed
  // даёт пустой результат и сбивает с толку. Если хочется
  // «installed AND running» — берётся через колоночные фильтры.
  const [activeFilter, setActiveFilter] = useState(null)
  const toggleFilter = (id) => {
    setActiveFilter((prev) => (prev === id ? null : id))
  }
  const clearFilters = () => setActiveFilter(null)
  const isFilterActive = (id) =>
    activeFilter === id || (id === 'all' && activeFilter === null)
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

  // Per-column filters. Каждое поле своего «вида»:
  //   slug/name   — text contains (case-insensitive)
  //   kind        — Set, пусто = любой
  //   dbSize      — bucket: any | empty | small (<10MB) | medium (10–100MB) | large (>100MB)
  //   updated     — bucket: any | week | month | quarter | older
  // Очищается отдельно на колонку или всё разом.
  const [columnFilters, setColumnFilters] = useState({
    slug: '',
    name: '',
    source: new Set(), // set of source providerIds (мульти-выбор)
    tasks: 'any',      // 'any' | 'with' | 'without'
    kind: new Set(),
    dbSize: 'any',
    updated: 'any'
  })
  const setColumnFilter = (key, value) => {
    setColumnFilters((prev) => ({ ...prev, [key]: value }))
  }
  const clearColumnFilters = () => {
    setColumnFilters({
      slug: '',
      name: '',
      source: new Set(),
      tasks: 'any',
      kind: new Set(),
      dbSize: 'any',
      updated: 'any'
    })
  }
  const hasColumnFilters =
    columnFilters.slug ||
    columnFilters.name ||
    columnFilters.source.size > 0 ||
    columnFilters.tasks !== 'any' ||
    columnFilters.kind.size > 0 ||
    columnFilters.dbSize !== 'any' ||
    columnFilters.updated !== 'any'
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

  // Map: slug → количество моих open Jira-тасков. Используется
  // для бейджа "📋 N" на строке и для пиннинга проектов с
  // активными тасками к верху списка. Источник — общий
  // useMyJiraIssues, тот же кэш, что у /my-tasks страницы.
  const myIssuesQuery = useMyJiraIssues({ maxResults: 100 })
  const taskCountBySlug = useMemo(() => {
    const map = new Map()
    for (const issue of myIssuesQuery.data?.issues || []) {
      const slug = parseSlugFromProjectName(issue?.project?.name)
      if (slug) map.set(slug, (map.get(slug) || 0) + 1)
    }
    return map
  }, [myIssuesQuery.data])

  // Список уникальных источников из текущей выборки проектов —
  // используется для multi-select фильтра колонки Source. Ключ —
  // providerId (стабильный uuid из config), label — имя source'а
  // плюс icon из VCS_PROVIDERS-реестра.
  const availableSources = useMemo(() => {
    const map = new Map()
    for (const p of projects || []) {
      const s = p.source
      if (!s?.providerId) continue
      if (!map.has(s.providerId)) {
        map.set(s.providerId, {
          id: s.providerId,
          type: s.type,
          name: s.name || s.type
        })
      }
    }
    return [...map.values()].sort((a, b) =>
      a.name.localeCompare(b.name)
    )
  }, [projects])

  const sortedAndFiltered = useMemo(() => {
    if (!projects) return []
    const q = search.trim().toLowerCase()
    const filtered = projects.filter((p) => {
      if (activeFilter === 'installed' && !p.local.cloned) return false
      if (activeFilter === 'not-installed' && p.local.cloned) return false
      if (activeFilter === 'running' && !runningBySlug.has(p.slug))
        return false
      if (activeFilter === 'projects' && p.kind !== 'project') return false
      if (activeFilter === 'templates' && p.kind !== 'template') return false
      if (q) {
        const hay = `${p.slug} ${p.name} ${p.description || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }

      // Column filters
      if (
        columnFilters.slug &&
        !p.slug.toLowerCase().includes(columnFilters.slug.toLowerCase())
      )
        return false
      if (
        columnFilters.name &&
        !p.name.toLowerCase().includes(columnFilters.name.toLowerCase())
      )
        return false
      if (columnFilters.source.size > 0) {
        const sid = p.source?.providerId
        if (!sid || !columnFilters.source.has(sid)) return false
      }
      if (columnFilters.tasks !== 'any') {
        const count = taskCountBySlug.get(p.slug) || 0
        if (columnFilters.tasks === 'with' && count === 0) return false
        if (columnFilters.tasks === 'without' && count > 0) return false
      }
      if (columnFilters.kind.size > 0 && !columnFilters.kind.has(p.kind))
        return false
      if (columnFilters.dbSize !== 'any') {
        const b = p.db.sizeBytes
        const exists = p.db.exists
        const mb = (b ?? 0) / (1024 * 1024)
        if (columnFilters.dbSize === 'empty' && (exists || (b ?? 0) > 0))
          return false
        if (columnFilters.dbSize === 'small' && !(exists && mb < 10))
          return false
        if (
          columnFilters.dbSize === 'medium' &&
          !(exists && mb >= 10 && mb < 100)
        )
          return false
        if (columnFilters.dbSize === 'large' && !(exists && mb >= 100))
          return false
      }
      if (columnFilters.updated !== 'any') {
        const t = p.updatedOn
          ? new Date(p.updatedOn).getTime()
          : 0
        const days = (Date.now() - t) / (24 * 60 * 60 * 1000)
        if (columnFilters.updated === 'week' && !(days <= 7)) return false
        if (columnFilters.updated === 'month' && !(days <= 30)) return false
        if (columnFilters.updated === 'quarter' && !(days <= 90))
          return false
        if (columnFilters.updated === 'older' && !(days > 90)) return false
      }
      return true
    })

    const sign = sort.direction === 'asc' ? 1 : -1
    return [...filtered].sort((a, b) => {
      // Избранные всегда наверху, независимо от сортировки.
      const aFav = !!favorites[a.slug]
      const bFav = !!favorites[b.slug]
      if (aFav !== bFav) return aFav ? -1 : 1
      // Затем — проекты, по которым у тебя есть открытые таски.
      // Они «приклеиваются» сверху неотсортированной массы, чтобы
      // активная работа не терялась среди 100+ репо.
      const aTasks = taskCountBySlug.get(a.slug) || 0
      const bTasks = taskCountBySlug.get(b.slug) || 0
      const aHasTasks = aTasks > 0
      const bHasTasks = bTasks > 0
      if (aHasTasks !== bHasTasks) return aHasTasks ? -1 : 1
      // Среди «equal» по тасковости сортируем по количеству тасков:
      // больше тасков → выше. Активная работа приоритетнее.
      if (aHasTasks && bHasTasks && aTasks !== bTasks) {
        return bTasks - aTasks
      }
      return compareProjects(a, b, sort.column, taskCountBySlug) * sign
    })
  }, [
    projects,
    activeFilter,
    search,
    runningBySlug,
    sort,
    favorites,
    columnFilters,
    taskCountBySlug
  ])

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


  return (
    <div className="flex h-screen w-screen">
      <aside className="w-60 border-r border-border bg-card flex flex-col">
        <div className="p-4 border-b border-border">
          <h1 className="text-lg font-semibold">{t('app.title')}</h1>
          {projects && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {t('app.reposInWorkspace', { count: projects.length })}
            </p>
          )}
        </div>
        <nav className="flex-1 p-3 text-sm overflow-y-auto">
          <WorkspaceNav active="projects" />
          {NAV_SECTIONS.map((section, sectionIdx) => (
            <div
              key={section.titleKey}
              className={cn(
                'space-y-1 pt-3 mt-3 border-t border-border'
              )}
            >
              <div className="px-3 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground/70">
                {t(section.titleKey)}
              </div>
              {section.items.map((f) => {
                const active = isFilterActive(f.id)
                return (
                  <button
                    key={f.id}
                    onClick={() =>
                      f.id === 'all' ? clearFilters() : toggleFilter(f.id)
                    }
                    className={cn(
                      'w-full text-left px-3 py-1.5 rounded-md flex items-center justify-between',
                      active
                        ? 'bg-accent text-accent-foreground'
                        : 'hover:bg-accent/60'
                    )}
                  >
                    <span>{t(f.labelKey)}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {counts[f.id] ?? 0}
                    </span>
                  </button>
                )
              })}
            </div>
          ))}

          {recent.length > 0 && projects && (
            <div className="pt-3 mt-3 border-t border-border">
              <div className="px-3 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground/70">
                {t('projects.recent')}
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
            {t('app.settings')}
          </Link>
        </div>
      </aside>

      <main className="flex-1 flex flex-col overflow-hidden relative">
        <header className="px-6 py-4 border-b border-border flex items-center justify-between gap-4">
          <div className="flex-1 max-w-md relative">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('projects.search.placeholder')}
              className="pl-9"
            />
          </div>
          <div className="flex items-center gap-3 ml-auto">
            <PresenceWidget />
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
              {t('common.refresh')}
            </Button>
          </div>
        </header>

        {warnings.length > 0 && <WarningBanner warnings={warnings} />}

        {hasColumnFilters && (
          <div className="px-6 py-1.5 border-b border-border/60 text-xs flex items-center gap-2">
            <Filter size={11} className="text-sky-400" />
            <span className="text-muted-foreground">
              {t('projects.columnFiltersActive')}
            </span>
            <button
              onClick={clearColumnFilters}
              className="ml-auto text-sky-400 hover:text-sky-300 underline-offset-2 hover:underline"
            >
              {t('projects.columnFilters.clear')}
            </button>
          </div>
        )}

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

        <div
          className={cn(
            'flex-1 overflow-auto transition-[padding] duration-200',
            selected.size > 0 && 'pb-20'
          )}
        >
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
              columnFilters={columnFilters}
              setColumnFilter={setColumnFilter}
              taskCountBySlug={taskCountBySlug}
              availableSources={availableSources}
              onOpen={(slug) => navigate(`/projects/${slug}`)}
            />
          )}
        </div>

        <FloatingBulkActions
          count={selected.size}
          onPull={onBulkPull}
          onStop={onBulkStop}
          onClear={clearSelected}
          busy={bulkBusy}
        />
      </main>

      <Outlet />
    </div>
  )
}

/**
 * Плавающая панель bulk-действий. Показывается над таблицей по центру
 * нижнего края main-секции, не отжимая контент вниз — это снимает
 * сбивающее с толку «строка под выделением сдвинулась». Скрывается
 * без layout shift через opacity + translate-y, без mount/unmount,
 * чтобы переход был плавным.
 *
 * Дизайн: компактная pill, иконка + большое число + лейбл, потом
 * вертикальный разделитель, потом действия как ghost-кнопки. Разделитель
 * визуально отделяет «что выбрано» от «что с этим делать», whitespace-nowrap
 * на всём баре — чтобы число и слово ни при каких i18n-комбинациях не
 * переезжали на новую строку.
 */
function FloatingBulkActions({ count, onPull, onStop, onClear, busy }) {
  const t = useT()
  const visible = count > 0
  return (
    <div
      aria-hidden={!visible}
      className={cn(
        'pointer-events-none absolute left-1/2 -translate-x-1/2 z-30 transition-all duration-200',
        visible
          ? 'bottom-4 opacity-100 translate-y-0'
          : 'bottom-0 opacity-0 translate-y-2'
      )}
    >
      <div
        className={cn(
          'flex items-center gap-1 rounded-full border border-border bg-popover/95 backdrop-blur shadow-xl pl-3 pr-1.5 py-1.5 text-xs whitespace-nowrap',
          visible && 'pointer-events-auto'
        )}
      >
        <CheckSquare size={14} className="text-amber-400 shrink-0" />
        <span className="font-medium tabular-nums">
          {t('projects.selected', { count })}
        </span>
        <span className="mx-1.5 h-5 w-px bg-border shrink-0" aria-hidden />
        <Button
          variant="ghost"
          size="sm"
          onClick={onPull}
          disabled={busy}
          className="h-7 px-2"
        >
          <GitPullRequest /> {t('projects.bulk.pull')}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onStop}
          disabled={busy}
          className="h-7 px-2"
        >
          <Square /> {t('projects.bulk.stop')}
        </Button>
        <span className="mx-0.5 h-5 w-px bg-border shrink-0" aria-hidden />
        <Button
          variant="ghost"
          size="sm"
          onClick={onClear}
          className="h-7 w-7 p-0"
          title={t('common.clear')}
        >
          <XIcon size={14} />
        </Button>
      </div>
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
  columnFilters,
  setColumnFilter,
  taskCountBySlug,
  availableSources,
  onOpen
}) {
  const t = useT()
  const compact = density === 'compact'
  // Compact ощутимо плотнее: уменьшаем не только padding, но и шрифт
  // тела + сжимаем подзаголовок (description под name) до nowrap.
  const cellPad = compact ? 'px-3 py-0.5' : 'px-4 py-2.5'
  const tableTextCls = compact ? 'text-xs' : 'text-sm'
  const nameTextCls = compact ? 'text-xs' : 'text-sm font-medium'
  const descCls = compact
    ? 'hidden'
    : 'text-xs text-muted-foreground line-clamp-1'
  if (total === 0) {
    return (
      <EmptyState
        title={t('projects.empty.title')}
        message={t('projects.empty.message')}
      />
    )
  }
  if (projects.length === 0) {
    return (
      <EmptyState
        title={t('projects.noMatches.title')}
        message={t('projects.noMatches.message', { count: total })}
      />
    )
  }

  return (
    <table className={cn('w-full', tableTextCls)}>
      <thead className="sticky top-0 bg-background border-b border-border z-10">
        <tr className="text-left text-xs text-muted-foreground">
          <th className={cn('font-normal w-8', cellPad)}></th>
          <th className={cn('font-normal w-8', cellPad)}></th>
          <th className={cn('font-normal w-20', cellPad)}>
            {t('projects.column.status')}
          </th>
          <ColumnHeader
            sortId="source"
            sort={sort}
            onSort={onSort}
            className={cn('w-36', cellPad)}
            label={t('projects.column.source')}
            filter={
              <SourceColumnFilter
                sources={availableSources}
                value={columnFilters.source}
                onChange={(v) => setColumnFilter('source', v)}
              />
            }
            active={columnFilters.source.size > 0}
          />
          <ColumnHeader
            sortId="slug"
            sort={sort}
            onSort={onSort}
            className={cn('w-32', cellPad)}
            label={t('projects.column.slug')}
            filter={
              <TextColumnFilter
                title={t('projects.filter.slug')}
                value={columnFilters.slug}
                onChange={(v) => setColumnFilter('slug', v)}
              />
            }
            active={!!columnFilters.slug}
          />
          <ColumnHeader
            sortId="name"
            sort={sort}
            onSort={onSort}
            className={cellPad}
            label={t('projects.column.name')}
            filter={
              <TextColumnFilter
                title={t('projects.filter.name')}
                value={columnFilters.name}
                onChange={(v) => setColumnFilter('name', v)}
              />
            }
            active={!!columnFilters.name}
          />
          <ColumnHeader
            sortId="tasks"
            sort={sort}
            onSort={onSort}
            className={cn('w-20', cellPad)}
            align="right"
            popoverAlign="right"
            label={t('projects.column.tasks')}
            filter={
              <BucketColumnFilter
                value={columnFilters.tasks}
                onChange={(v) => setColumnFilter('tasks', v)}
                options={[
                  { value: 'any', label: t('projects.tasks.any') },
                  { value: 'with', label: t('projects.tasks.with') },
                  { value: 'without', label: t('projects.tasks.without') }
                ]}
              />
            }
            active={columnFilters.tasks !== 'any'}
          />
          <ColumnHeader
            className={cn('w-24', cellPad)}
            label={t('projects.column.kind')}
            filter={
              <KindColumnFilter
                value={columnFilters.kind}
                onChange={(v) => setColumnFilter('kind', v)}
              />
            }
            active={columnFilters.kind.size > 0}
          />
          <ColumnHeader
            sortId="dbSize"
            sort={sort}
            onSort={onSort}
            className={cn('w-24', cellPad)}
            align="right"
            popoverAlign="right"
            label={t('projects.column.dbSize')}
            filter={
              <BucketColumnFilter
                value={columnFilters.dbSize}
                onChange={(v) => setColumnFilter('dbSize', v)}
                options={[
                  { value: 'any', label: t('projects.dbSize.any') },
                  { value: 'empty', label: t('projects.dbSize.empty') },
                  { value: 'small', label: t('projects.dbSize.small') },
                  { value: 'medium', label: t('projects.dbSize.medium') },
                  { value: 'large', label: t('projects.dbSize.large') }
                ]}
              />
            }
            active={columnFilters.dbSize !== 'any'}
          />
          <ColumnHeader
            sortId="lastCommit"
            sort={sort}
            onSort={onSort}
            className={cn('w-32', cellPad)}
            popoverAlign="right"
            label={t('projects.column.lastCommit')}
            filter={
              <BucketColumnFilter
                value={columnFilters.updated}
                onChange={(v) => setColumnFilter('updated', v)}
                options={[
                  { value: 'any', label: t('projects.lastCommit.any') },
                  { value: 'week', label: t('projects.lastCommit.week') },
                  { value: 'month', label: t('projects.lastCommit.month') },
                  { value: 'quarter', label: t('projects.lastCommit.quarter') },
                  { value: 'older', label: t('projects.lastCommit.older') }
                ]}
              />
            }
            active={columnFilters.updated !== 'any'}
          />
        </tr>
      </thead>
      <tbody>
        {projects.map((p) => (
          <ProjectRow
            key={p.slug}
            p={p}
            openSlug={openSlug}
            runtime={runningBySlug.get(p.slug) || null}
            favorite={!!favorites[p.slug]}
            onToggleFavorite={() => toggleFavorite(p.slug)}
            selected={selected.has(p.slug)}
            onToggleSelected={() => toggleSelected(p.slug)}
            onOpen={() => onOpen(p.slug)}
            search={search}
            cellPad={cellPad}
            nameTextCls={nameTextCls}
            descCls={descCls}
            taskCount={taskCountBySlug?.get(p.slug) || 0}
          />
        ))}
      </tbody>
    </table>
  )
}

/**
 * Строка таблицы, вынесенная отдельно, чтобы держать per-row
 * useState/useEffect для hover-debounce и lazy-fetch последнего
 * пайплайна. Pipelines status для обычной строки грузится
 * только когда:
 *   1) проект starred (deterministic prefetch — для тех репо,
 *      на которые пользователь смотрит чаще всего), либо
 *   2) пользователь навёл мышь и подержал её 500 мс.
 *
 * Так избегаем взрыва 70+ pipelines-запросов при первой загрузке.
 */
function ProjectRow({
  p,
  openSlug,
  runtime,
  favorite,
  onToggleFavorite,
  selected,
  onToggleSelected,
  onOpen,
  search,
  cellPad,
  nameTextCls,
  descCls,
  taskCount
}) {
  const t = useT()
  const trRef = useRef(null)
  // Гейтим pipeline-запрос на момент попадания строки во вьюпорт.
  // Раньше было «грузим только при наведении 500мс», из-за чего dot
  // у видимых строк был серым — данные не подтягивались сами. Теперь
  // ровно когда строка стала видимой — летит запрос, один раз.
  const [seen, setSeen] = useState(favorite)
  useEffect(() => {
    if (seen) return
    const node = trRef.current
    if (!node || typeof IntersectionObserver === 'undefined') {
      setSeen(true)
      return
    }
    const obs = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setSeen(true)
        obs.disconnect()
      }
    })
    obs.observe(node)
    return () => obs.disconnect()
  }, [seen])
  const { data: builds } = useBuilds(p.slug, {
    pagelen: 1,
    enabled: seen
  })
  const lastPipeline = builds?.[0] || null

  return (
    <tr
      ref={trRef}
      onClick={onOpen}
      className={cn(
        'border-b border-border/60 cursor-pointer hover:bg-accent/40',
        openSlug === p.slug && 'bg-accent/60'
      )}
    >
      <td
        className={cn(cellPad, 'cursor-pointer group/cell')}
        onClick={(e) => {
          e.stopPropagation()
          onToggleSelected()
        }}
        title={
          selected ? t('projects.row.unselect') : t('projects.row.select')
        }
      >
        {/* pointer-events-none: вся td уже клик-зона, не дублируем
            обработчик от Radix Checkbox */}
        <div className="flex items-center justify-center pointer-events-none">
          <Checkbox checked={selected} tabIndex={-1} aria-hidden />
        </div>
      </td>
      <td
        className={cn(
          cellPad,
          'cursor-pointer transition-colors',
          favorite
            ? 'text-amber-400 hover:text-amber-300'
            : 'text-muted-foreground/30 hover:text-amber-400'
        )}
        onClick={(e) => {
          e.stopPropagation()
          onToggleFavorite()
        }}
        title={favorite ? t('projects.row.unpin') : t('projects.row.pin')}
      >
        <div className="flex items-center justify-center">
          <Star
            size={16}
            className={cn('shrink-0', favorite && 'fill-current')}
          />
        </div>
      </td>
      <td className={cellPad}>
        <StatusDots
          project={p}
          runtime={runtime}
          lastPipeline={lastPipeline}
          pipelineLoaded={seen}
        />
      </td>
      <td className={cn(cellPad, 'text-xs')}>
        <div className="inline-flex items-center gap-1.5 min-w-0">
          <SourceBadge
            type={p.source?.type}
            sourceName={p.source?.name}
          />
          <span className="text-muted-foreground truncate">
            {p.source?.name || p.source?.type || '—'}
          </span>
        </div>
      </td>
      <td className={cn(cellPad, 'font-mono text-xs')}>
        <Highlight text={p.slug} match={search} />
      </td>
      <td className={cellPad}>
        <div className={nameTextCls}>
          <Highlight text={p.name} match={search} />
        </div>
        {p.description && (
          <div className={descCls}>
            <Highlight text={p.description} match={search} />
          </div>
        )}
      </td>
      <td className={cn(cellPad, 'text-right tabular-nums')}>
        {taskCount > 0 ? (
          <span
            title={t('projects.row.taskCount', { count: taskCount })}
            className="inline-flex items-center gap-1 text-[11px] leading-none px-1.5 py-1 rounded-md bg-sky-500/15 border border-sky-500/40 text-sky-200 font-sans font-medium"
          >
            <ListTodo size={12} className="shrink-0" />
            {taskCount}
          </span>
        ) : (
          <span className="text-muted-foreground/40 text-xs">—</span>
        )}
      </td>
      <td className={cellPad}>
        <KindBadge kind={p.kind} />
      </td>
      <td
        className={cn(
          cellPad,
          'text-right text-xs text-muted-foreground tabular-nums'
        )}
      >
        {formatBytes(p.db.sizeBytes)}
      </td>
      <td className={cn(cellPad, 'text-xs text-muted-foreground')}>
        {formatRelative(p.updatedOn)}
      </td>
    </tr>
  )
}

/**
 * Точка статуса последнего пайплайна с tooltip. Если запрос ещё
 * не выполнен (строка ещё не попала во вьюпорт / не загрузилась) —
 * рендерим dim-кружок, чтобы не было визуальных скачков по ширине.
 * Когда данные пришли — это PipelineStateBadge с реальным цветом.
 *
 * Wrapper всегда `inline-flex items-center` с фиксированной высотой —
 * иначе flex-родитель в StatusDots ловит разную высоту inline и
 * inline-block потомков и кружки оказываются на разных уровнях.
 */
function PipelineCell({ pipeline, loaded }) {
  const t = useT()
  const wrapperCls = 'inline-flex items-center justify-center w-2 h-2'
  if (!loaded) {
    return (
      <span
        title={t('projects.pipeline.loading')}
        className={cn(wrapperCls, 'rounded-full bg-muted-foreground/15')}
      />
    )
  }
  if (!pipeline) {
    return (
      <span
        title={t('projects.pipeline.noPipelines')}
        className={cn(wrapperCls, 'rounded-full bg-muted-foreground/25')}
      />
    )
  }
  const tooltip = `${t('projects.pipeline.lastPipeline', {
    state: pipeline.state
  })}${
    pipeline.createdOn ? ' · ' + formatRelative(pipeline.createdOn) : ''
  }${pipeline.buildNumber ? ' · #' + pipeline.buildNumber : ''}`
  return (
    <span title={tooltip} className="inline-flex items-center">
      <PipelineStateBadge state={pipeline.state} dotOnly />
    </span>
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

/**
 * Унифицированный заголовок колонки: опциональный sort + опциональный
 * фильтр-popover. Если sortId не задан — это просто текст с фильтром
 * (Kind). Иконка фильтра подсвечивается когда фильтр активен.
 */
function ColumnHeader({
  sortId,
  sort,
  onSort,
  children,
  label,
  className,
  align = 'left',
  popoverAlign,
  filter,
  active
}) {
  const t = useT()
  // По умолчанию popover открывается от того же края, что и колонка
  // выровнена. Для крайних правых колонок (DB size, Last commit) это
  // спасает от вылета поповера за окно.
  const popAlign = popoverAlign || align
  const sortable = !!sortId
  const sortActive = sortable && sort?.column === sortId
  const Arrow = sort?.direction === 'asc' ? ChevronUp : ChevronDown
  return (
    <th className={cn('font-normal', className)}>
      <div
        className={cn(
          'inline-flex items-center gap-1',
          align === 'right' && 'justify-end w-full'
        )}
      >
        {sortable ? (
          <button
            onClick={() => onSort(sortId)}
            className={cn(
              'inline-flex items-center gap-1 hover:text-foreground transition-colors',
              sortActive && 'text-foreground'
            )}
          >
            {label}
            {sortActive && <Arrow size={12} />}
          </button>
        ) : (
          <span>{label}</span>
        )}
        {filter && (
          <Popover
            align={popAlign}
            trigger={
              <button
                title={t('projects.filter.title.tooltip')}
                className={cn(
                  'p-0.5 rounded hover:bg-accent transition-colors',
                  active
                    ? 'text-sky-400'
                    : 'text-muted-foreground/50 hover:text-foreground'
                )}
              >
                <Filter size={11} className={active ? 'fill-current' : ''} />
              </button>
            }
          >
            {filter}
          </Popover>
        )}
      </div>
    </th>
  )
}

/**
 * Кастомный popover без новых deps. Click-outside и Escape закрывают.
 * Trigger принимает любой клик-handlable элемент.
 */
function PresenceWidget() {
  const t = useT()
  const navigate = useNavigate()
  const { sessions, enabled, me, others } = usePresence()
  const totalOnline = enabled ? sessions.length : 0

  const trigger = (
    <button
      title={
        enabled
          ? t('presence.tooltip.online', { count: totalOnline })
          : t('presence.tooltip.disabled')
      }
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 h-8 rounded-md border text-xs transition-colors',
        enabled
          ? 'border-input hover:bg-accent text-foreground'
          : 'border-border text-muted-foreground hover:text-foreground'
      )}
    >
      <Users size={14} />
      <span className="tabular-nums">{totalOnline}</span>
    </button>
  )

  return (
    <Popover trigger={trigger} align="right">
      <div className="min-w-[260px] space-y-2">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {t('presence.online', { count: totalOnline })}
        </div>
        {!enabled && (
          <div className="text-xs text-muted-foreground space-y-2">
            <div>{t('presence.disabled.line')}</div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate('/settings')}
            >
              {t('common.openSettings')}
            </Button>
          </div>
        )}
        {enabled && others.length === 0 && me && (
          <div className="space-y-2">
            <PresenceItem session={me} />
            <div className="text-xs text-muted-foreground pt-1 border-t border-border/50">
              {t('presence.noOthers')}
            </div>
          </div>
        )}
        {enabled && others.length === 0 && !me && (
          <div className="text-xs text-muted-foreground">
            {t('presence.starting')}
          </div>
        )}
        {enabled && others.length > 0 && (
          <ul className="space-y-2">
            {me && (
              <li>
                <PresenceItem session={me} />
              </li>
            )}
            {others.map((s) => (
              <li
                key={s.id}
                className="pt-2 border-t border-border/50 first:border-0 first:pt-0"
              >
                <PresenceItem session={s} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </Popover>
  )
}

function PresenceItem({ session }) {
  const t = useT()
  return (
    <div>
      <div className="text-sm font-medium flex items-center gap-1.5 flex-wrap">
        <span className="font-mono">{session.host}</span>
        <span className="text-muted-foreground">/</span>
        <span>{session.user}</span>
        {session.isMe && (
          <span className="text-[10px] text-sky-400">{t('common.you')}</span>
        )}
      </div>
      <div className="text-[11px] text-muted-foreground flex items-center gap-2 flex-wrap mt-0.5">
        <span>v{session.version}</span>
        {session.ip && (
          <>
            <span>·</span>
            <code className="text-[10px]">{session.ip}</code>
          </>
        )}
        <span>·</span>
        <span>
          {t('presence.since', {
            time: formatRelative(session.startedAt)
          })}
        </span>
      </div>
    </div>
  )
}

function Popover({ trigger, children, align = 'left' }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target))
        setOpen(false)
    }
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <span ref={wrapRef} className="relative inline-block">
      <span
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
      >
        {trigger}
      </span>
      {open && (
        <div
          className={cn(
            'absolute top-full mt-1 z-30 min-w-[200px] bg-popover border border-border rounded-md shadow-lg p-3',
            align === 'right' ? 'right-0' : 'left-0'
          )}
        >
          {children}
        </div>
      )}
    </span>
  )
}

function TextColumnFilter({ title, value, onChange }) {
  const t = useT()
  return (
    <div className="space-y-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      <Input
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t('projects.filter.contains')}
        className="h-7 text-xs"
      />
      {value && (
        <button
          onClick={() => onChange('')}
          className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
        >
          <XIcon size={10} /> {t('common.clear')}
        </button>
      )}
    </div>
  )
}

/**
 * Multi-select фильтр по конкретным VCS-источникам (а не только по
 * типу). Если у юзера два GitHub-source'а (work + personal), он
 * сможет фильтровать каждый отдельно. Опции = все source'ы из
 * текущего списка проектов; ключ = providerId.
 */
function SourceColumnFilter({ sources, value, onChange }) {
  const t = useT()
  const toggle = (id) => {
    const next = new Set(value)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onChange(next)
  }
  if (!sources || sources.length === 0) {
    return (
      <div className="text-xs text-muted-foreground italic">
        {t('projects.filter.source.empty')}
      </div>
    )
  }
  return (
    <div className="space-y-1.5">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {t('projects.filter.source')}
      </div>
      {sources.map((s) => {
        const provider = getVcsProvider(s.type)
        const Icon = provider?.BadgeIcon
        return (
          <label
            key={s.id}
            className="flex items-center gap-2 text-xs cursor-pointer"
          >
            <input
              type="checkbox"
              checked={value.has(s.id)}
              onChange={() => toggle(s.id)}
              className="rounded border-input"
            />
            {Icon && (
              <Icon
                size={11}
                className={cn(
                  'shrink-0',
                  provider?.badgeClassName || 'text-muted-foreground'
                )}
              />
            )}
            <span className="truncate">{s.name}</span>
          </label>
        )
      })}
      {value.size > 0 && (
        <button
          onClick={() => onChange(new Set())}
          className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mt-1"
        >
          <XIcon size={10} /> {t('common.clear')}
        </button>
      )}
    </div>
  )
}

function KindColumnFilter({ value, onChange }) {
  const t = useT()
  const opts = [
    { id: 'project', label: t('projects.kind.project') },
    { id: 'template', label: t('projects.kind.template') }
  ]
  const toggle = (k) => {
    const next = new Set(value)
    if (next.has(k)) next.delete(k)
    else next.add(k)
    onChange(next)
  }
  return (
    <div className="space-y-1.5">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {t('projects.filter.kind')}
      </div>
      {opts.map((opt) => (
        <label
          key={opt.id}
          className="flex items-center gap-2 text-xs cursor-pointer"
        >
          <input
            type="checkbox"
            checked={value.has(opt.id)}
            onChange={() => toggle(opt.id)}
            className="rounded border-input"
          />
          <span>{opt.label}</span>
        </label>
      ))}
      {value.size > 0 && (
        <button
          onClick={() => onChange(new Set())}
          className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mt-1"
        >
          <XIcon size={10} /> {t('common.clear')}
        </button>
      )}
    </div>
  )
}

function BucketColumnFilter({ value, onChange, options }) {
  return (
    <div className="space-y-1.5">
      {options.map((o) => (
        <label
          key={String(o.value)}
          className="flex items-center gap-2 text-xs cursor-pointer"
        >
          <input
            type="radio"
            checked={value === o.value}
            onChange={() => onChange(o.value)}
            className="border-input"
          />
          <span>{o.label}</span>
        </label>
      ))}
    </div>
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

/**
 * Компактный индикатор статуса проекта.
 *
 * Раньше было 4 кружка, всегда видимые: cloned, db, dirty, running.
 * Большая часть из них почти всегда серые, что создаёт визуальный
 * шум и впечатление «всё мёртвое». Теперь:
 *
 *   - **Install**: один tri-state кружок, кодирующий cloned + db
 *     одновременно — серый (не склонирован), янтарный (склонирован,
 *     БД нет), зелёный (склонирован + БД есть).
 *   - **Running**: показывается только когда проект запущен
 *     (sky pulse + ссылка на browser). В покое не занимает места.
 *   - **Pipeline**: всегда виден, цвет реальный (через PipelineCell).
 *     Подгрузка ленивая — IntersectionObserver, см. ProjectRow.
 *
 * «Dirty»-кружок (uncommitted changes) убран до тех пор, пока
 * git-статус не подтягивается в общем enrichment'е — раньше он был
 * захардкожен в false и просто всегда оставался серым.
 */
function StatusDots({ project, runtime, lastPipeline, pipelineLoaded }) {
  const t = useT()
  const running = !!runtime
  const cloned = project.local.cloned
  const hasDb = project.db.exists
  // skipDb — намерение проекта «у меня нет БД» (frontend / library /
  // CLI / etc.). Раньше для таких проектов install-кружок висел
  // amber'ом потому что hasDb=false, и казалось будто что-то не так.
  // Теперь skipDb-проекты считаются полностью готовыми после clone'а.
  const skipDb = !!project.db.skipDb

  let installColor, installTitle
  if (!cloned) {
    installColor = 'bg-muted-foreground/25'
    installTitle = t('projects.statusDots.notCloned')
  } else if (skipDb) {
    installColor = 'bg-emerald-500'
    installTitle = t('projects.statusDots.clonedNoDbNeeded')
  } else if (!hasDb) {
    installColor = 'bg-amber-500'
    installTitle = t('projects.statusDots.clonedNoDb', {
      name: project.db.name
    })
  } else {
    installColor = 'bg-emerald-500'
    installTitle = t('projects.statusDots.clonedWithDb', {
      name: project.db.name
    })
  }

  // leading-none на родителе важно: иначе flex-bbox внутри tablecell
  // получает высоту line-height, а кружки сохраняют baseline-смещение
  // и визуально расходятся по вертикали. С leading-none и явным h-3
  // (12px — выше любого 8px-кружка) все элементы центрируются ровно.
  return (
    <div className="inline-flex gap-1.5 items-center leading-none h-3">
      <span
        title={installTitle}
        className={cn(
          'inline-flex w-2 h-2 rounded-full shrink-0',
          installColor
        )}
      />
      <PipelineCell pipeline={lastPipeline} loaded={pipelineLoaded} />
      {running && (
        <span
          title={t('projects.statusDots.running', {
            port: runtime?.port ?? '?',
            pid: runtime?.pid
          })}
          className="inline-flex w-2 h-2 rounded-full shrink-0 bg-sky-500 animate-pulse"
        />
      )}
      {running && runtime?.url && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            window.open(runtime.url, '_blank')
          }}
          title={t('projects.row.openInBrowser', { url: runtime.url })}
          className="ml-0.5 inline-flex items-center text-muted-foreground hover:text-sky-500 transition-colors"
        >
          <ExternalLink size={11} />
        </button>
      )}
    </div>
  )
}

/**
 * Маленький бейдж типа источника рядом со slug в таблице. Делает
 * однозначно понятным, откуда приехал репозиторий, при настроенных
 * нескольких источниках разного типа.
 *
 * Иконки/цвета берутся из VCS_PROVIDERS (renderer-side реестр).
 * Unknown type рендерится initials'ами имени источника — на случай
 * downgrade'а с провайдером, которого ещё нет в текущей версии.
 */
function SourceBadge({ type, sourceName }) {
  if (!type) return null
  const provider = getVcsProvider(type)
  if (provider) {
    const Icon = provider.BadgeIcon
    return (
      <span
        title={provider.label}
        className={`inline-flex items-center shrink-0 ${provider.badgeClassName}`}
      >
        <Icon size={12} />
      </span>
    )
  }
  // Fallback для неизвестного провайдера: 2 буквы из имени.
  const initials = (sourceName || type).slice(0, 2).toUpperCase()
  return (
    <span
      title={sourceName || type}
      className="inline-flex items-center justify-center shrink-0 text-[9px] font-mono text-muted-foreground/60 px-1 border border-border rounded"
    >
      {initials}
    </span>
  )
}

function KindBadge({ kind }) {
  const t = useT()
  // Раньше badge рендерился на каждой строке (включая plain 'project'),
  // что было визуальным шумом — все репо в большинстве sources это
  // обычные projects. Сейчас бейдж только для template-репо: BB по
  // настраиваемому prefix project.key (default 'TP'), GitHub по
  // is_template-флагу. GitLab / AzDO не имеют понятия template и
  // никогда не подсвечиваются. Plain projects не рендерятся —
  // отсутствие бейджа = «обычный repo».
  if (kind !== 'template') return null
  return (
    <span
      title={t('projects.kind.template.hint')}
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs border',
        'bg-amber-500/15 text-amber-400 border-amber-500/30'
      )}
    >
      <FileCode2 size={11} />
      {t('projects.kind.template')}
    </span>
  )
}

/**
 * Sticky bar в шапке main-секции, виден когда есть хоть один
 * запущенный dotnet. Чипсы по проектам: клик по slug → drawer,
 * клик по :port → внешний браузер, клик по ✕ → stop.
 */
function RunningBar({ running, onOpen, onStop }) {
  const t = useT()
  if (!running || running.length === 0) return null
  return (
    <div className="px-6 py-2 border-b border-sky-500/30 bg-sky-500/10 flex items-center gap-2 flex-wrap text-xs">
      <span className="text-sky-400 font-medium">
        {t('projects.runningBar.label', { count: running.length })}
      </span>
      {running.map((r) => (
        <span
          key={r.slug}
          className="inline-flex items-center gap-1 rounded-md border border-sky-500/40 bg-sky-500/15 px-2 py-0.5"
        >
          <button
            onClick={() => onOpen(r.slug)}
            className="font-mono text-sky-300 hover:text-sky-100"
            title={t('projects.runningBar.openDrawer', { slug: r.slug })}
          >
            {r.slug}
          </button>
          {r.url ? (
            <button
              onClick={(e) => {
                e.stopPropagation()
                window.open(r.url, '_blank')
              }}
              title={t('projects.row.openInBrowser', { url: r.url })}
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
            title={t('projects.bulk.stop')}
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
  const t = useT()
  const message = error?.message || String(error)
  const isConfig =
    /credentials/i.test(message) || /workspace not set/i.test(message)
  return (
    <SharedErrorState
      title={t('projects.error.title')}
      message={message}
      cta={
        isConfig ? (
          <Link
            to="/settings"
            className="inline-flex items-center gap-2 text-sm text-primary underline-offset-4 hover:underline"
          >
            <SettingsIcon size={14} />
            {t('common.openSettings')}
          </Link>
        ) : null
      }
    />
  )
}

// Унифицированный EmptyState теперь живёт в @/components/states.
// Локальная обёртка-прокси оставлена чтобы не править все call-сайты
// сразу — добавляет неявный icon = null, как было раньше.
function EmptyState({ title, message }) {
  return <SharedEmptyState title={title} message={message} />
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
