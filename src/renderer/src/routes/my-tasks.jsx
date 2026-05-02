import { useEffect, useMemo, useRef, useState } from 'react'
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
  AlertCircle,
  ChevronDown,
  Send,
  Pencil,
  Check
} from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import {
  useMyJiraIssues,
  useJiraIssueDetail,
  useJiraTransitions,
  useJiraAssignableUsers,
  useAddJiraComment,
  useSetJiraAssignee,
  useApplyJiraTransition,
  parseSlugFromProjectName
} from '@/hooks/use-jira'
import { useProjects } from '@/hooks/use-projects'
import { AdfRenderer } from '@/components/adf-renderer'
import {
  EmptyState as SharedEmptyState,
  ErrorState as SharedErrorState,
  ListSkeleton as SharedListSkeleton
} from '@/components/states'
import { useT } from '@/i18n'
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
  const t = useT()
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
          <h1 className="text-lg font-semibold">{t('app.title')}</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t('tasks.subtitle')}
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
            {t('app.settings')}
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
              placeholder={t('tasks.search.placeholder')}
              className="pl-9"
            />
          </div>
          <div className="flex items-center gap-3 ml-auto">
            {data && (
              <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                {filtered.length === issues.length
                  ? t('tasks.count.full', { count: issues.length })
                  : t('tasks.count.partial', {
                      shown: filtered.length,
                      total: issues.length
                    })}
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
              {t('common.refresh')}
            </Button>
          </div>
        </header>

        <div className="flex-1 overflow-auto">
          {isLoading && <SharedListSkeleton rows={8} />}
          {isError && (
            <SharedErrorState
              title={t('tasks.error.title')}
              error={error}
              cta={
                /credentials|host|configured/i.test(
                  error?.message || ''
                ) ? (
                  <Link
                    to="/settings"
                    className="inline-flex items-center gap-2 text-sm text-primary underline-offset-4 hover:underline"
                  >
                    <SettingsIcon size={14} />{' '}
                    {t('tasks.error.openJiraSettings')}
                  </Link>
                ) : null
              }
            />
          )}
          {!isLoading && !isError && issues.length === 0 && (
            <SharedEmptyState
              icon={ListTodo}
              title={t('tasks.empty.noOpen')}
              message={t('tasks.empty.message')}
              cta={
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate('/settings')}
                >
                  <SettingsIcon size={14} /> {t('common.openSettings')}
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
  const t = useT()
  return (
    <div className="space-y-1">
      <div className="px-3 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground/70">
        {t('app.workspace')}
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
        <span>{t('app.workspace.allProjects')}</span>
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
        <span>{t('app.workspace.myTasks')}</span>
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
      // Atlassian возвращает statusCategoryName уже на языке профиля
      // юзера в Atlassian. Если строки нет — фолбэчимся на наш
      // i18n-ключ (через categoryLabelKey ниже).
      buckets.set(key, {
        key,
        atlassianLabel: it.statusCategoryName || null,
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

function categoryLabelKey(category) {
  switch (category) {
    case 'new':
      return 'tasks.group.todo'
    case 'indeterminate':
      return 'tasks.group.inProgress'
    case 'done':
      return 'tasks.group.done'
    default:
      return 'tasks.group.other'
  }
}

function TaskGroups({ groups, openedKey, onOpen }) {
  const t = useT()
  if (groups.length === 0) {
    return (
      <SharedEmptyState
        icon={ListTodo}
        title={t('tasks.empty.noMatches.title')}
        message={t('tasks.empty.noMatches.message')}
      />
    )
  }
  return (
    <div className="divide-y divide-border/60">
      {groups.map((g) => (
        <section key={g.key}>
          <div className="px-6 py-2 text-[11px] uppercase tracking-wide text-muted-foreground bg-muted/20">
            {g.atlassianLabel || t(categoryLabelKey(g.key))}{' '}
            <span className="tabular-nums">({g.items.length})</span>
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
    <aside className="w-1/2 border-l border-border bg-background flex flex-col">
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
        <TaskDetailContent issueKey={issueKey} detail={detail} />
      </div>
    </aside>
  )
}

export function TaskDetailContent({ issueKey, detail }) {
  const t = useT()
  if (detail.isLoading) {
    return (
      <div className="text-xs text-muted-foreground inline-flex items-center gap-2">
        <Loader2 size={12} className="animate-spin" /> {t('common.loading')}
      </div>
    )
  }
  if (detail.isError || !detail.data) {
    return (
      <div className="text-xs text-destructive">
        {t('tasks.detail.cantLoad')}
      </div>
    )
  }
  const d = detail.data
  return (
    <>
      {/* Шапочные chip'ы — статус, тип, приоритет на одной строке.
          Сразу видно главное о таске одним взглядом. Status кликабелен
          и открывает список доступных переходов (transitions). */}
      <div className="flex items-center gap-2 flex-wrap">
        <StatusPicker
          issueKey={issueKey}
          category={d.statusCategory}
          label={d.status}
        />
        {d.issueType && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-sm bg-muted/50 text-muted-foreground border border-border/40 inline-flex items-center gap-1">
            {d.issueTypeIconUrl && (
              <img
                src={d.issueTypeIconUrl}
                alt=""
                className="w-3 h-3"
              />
            )}
            {d.issueType}
          </span>
        )}
        {d.priority && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-sm bg-muted/50 text-muted-foreground border border-border/40 inline-flex items-center gap-1">
            {d.priorityIconUrl && (
              <img
                src={d.priorityIconUrl}
                alt=""
                className="w-3 h-3"
              />
            )}
            {d.priority}
          </span>
        )}
      </div>

      {/* Project — короткая инлайн-строчка. Если в Bitbucket есть
          репо с этим slug'ом, то это кликабельная ссылка которая
          открывает project drawer с заранее выбранной Tasks-табой
          и раскрытой текущей задачей: пользователь сразу видит
          и таск, и кнопки Run/Pull/Open VS Code в шапке drawer'а. */}
      <ProjectLine project={d.project} issueKey={issueKey} />

      {/* People — отдельной строкой каждая роль, формат как у
          комментариев: avatar | name · role. Так визуально однородно
          с комментариями ниже и не выглядит «по центру вертикально».
          Assignee кликабельный — открывает поиск пользователей,
          Reporter read-only (Jira не позволяет менять). */}
      <ul className="space-y-1.5">
        <AssigneePicker issueKey={issueKey} person={d.assignee} />
        <PersonRow role={t('tasks.role.reporter')} person={d.reporter} />
      </ul>

      {/* Times + due — одной серой строкой внизу metadata */}
      <div className="text-[11px] text-muted-foreground">
        {t('tasks.detail.updated')} {formatRelative(d.updated)} ·{' '}
        {t('tasks.detail.created')} {formatRelative(d.created)}
        {d.duedate && (
          <>
            {' '}·{' '}
            <span className="text-amber-400">
              {t('tasks.detail.due', { date: d.duedate })}
            </span>
          </>
        )}
      </div>

      {/* Labels — если есть */}
      {d.labels.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {d.labels.map((l) => (
            <span
              key={l}
              className="text-[10px] px-1.5 py-0.5 rounded-sm bg-muted/50 font-mono text-muted-foreground"
            >
              {l}
            </span>
          ))}
        </div>
      )}

      {d.description && (
        <section className="space-y-1.5">
          <h3 className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {t('tasks.detail.description')}
          </h3>
          <div className="text-xs bg-muted/20 border border-border/40 rounded-md px-3 py-2.5 leading-relaxed">
            <AdfRenderer node={d.description} />
          </div>
        </section>
      )}

      <section className="space-y-2">
        {d.comments.length > 0 && (
          <>
            <h3 className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {t('tasks.detail.comments', { count: d.comments.length })}
            </h3>
            <ul className="space-y-3">
              {d.comments.map((c) => (
                <li key={c.id} className="flex gap-2.5">
                  <Avatar name={c.author} size={24} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] flex items-center gap-1.5">
                      <strong className="text-foreground/85">
                        {c.author}
                      </strong>
                      <span className="text-muted-foreground">
                        · {formatRelative(c.created)}
                      </span>
                    </div>
                    <div className="text-xs mt-0.5 leading-relaxed">
                      <AdfRenderer node={c.body} />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
        <CommentForm issueKey={issueKey} />
      </section>
    </>
  )
}

/**
 * Project-line в task detail. Парсит slug из имени Jira-проекта
 * ("p0066- Zeiad Jewellery" → "p0066") и сверяет со списком
 * Bitbucket-репо. Если репо найдено — рендерит кликабельную
 * стрелку, которая ведёт в /projects/<slug>?tab=tasks&issue=<key>:
 * project drawer открывается на Tasks-табе с раскрытой текущей
 * задачей. Таск не теряется — он там же inline.
 */
function ProjectLine({ project, issueKey }) {
  const t = useT()
  const navigate = useNavigate()
  const { projects: bitbucketProjects } = useProjects()
  const candidate = parseSlugFromProjectName(project?.name)
  const matched = useMemo(() => {
    if (!candidate || !bitbucketProjects) return null
    return (
      bitbucketProjects.find(
        (p) => p.slug.toLowerCase() === candidate
      ) || null
    )
  }, [candidate, bitbucketProjects])
  const inner = (
    <>
      {t('tasks.detail.in')}{' '}
      <code className="font-mono text-foreground/80">{project.key}</code>
      {' '}— {project.name}
    </>
  )
  if (!matched) {
    return <div className="text-xs text-muted-foreground">{inner}</div>
  }
  const target = `/projects/${encodeURIComponent(matched.slug)}?tab=tasks&issue=${encodeURIComponent(issueKey || '')}`
  return (
    <button
      onClick={() => navigate(target)}
      title={t('projects.runningBar.openDrawer', { slug: matched.slug })}
      className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 underline-offset-2 hover:underline text-left"
    >
      {inner}
      <ArrowLeftRight size={10} />
    </button>
  )
}

/**
 * Хук для click-outside детекции — закрывает popup'ы когда
 * пользователь кликнул вне их. Возвращает ref, который надо
 * прикрепить к контейнеру попапа. Reserve — так минимально
 * инвазивно встраивается в существующие компоненты.
 */
function useClickOutside(callback) {
  const ref = useRef(null)
  useEffect(() => {
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) callback()
    }
    const onKey = (e) => {
      if (e.key === 'Escape') callback()
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [callback])
  return ref
}

/**
 * Status badge + dropdown с доступными transitions. Клик по бейджу
 * открывает список переходов (load lazy). Клик по transition'у
 * применяет его и закрывает popup; query'и invalidate'ятся в хуке.
 */
function StatusPicker({ issueKey, category, label }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const transitions = useJiraTransitions(issueKey, { enabled: open })
  const apply = useApplyJiraTransition(issueKey)
  const ref = useClickOutside(() => setOpen(false))
  const onPick = async (transitionId) => {
    try {
      await apply.mutateAsync(transitionId)
      setOpen(false)
    } catch {
      // ошибка остаётся в apply.error — отрендерим в popup
    }
  }
  return (
    <span ref={ref} className="relative inline-flex">
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={apply.isPending}
        className="inline-flex items-center gap-1 cursor-pointer disabled:opacity-60"
        title={t('tasks.statusPicker.tooltip')}
      >
        <StatusBadge category={category} label={label} />
        {apply.isPending ? (
          <Loader2 size={11} className="animate-spin text-muted-foreground" />
        ) : (
          <ChevronDown
            size={11}
            className="text-muted-foreground"
          />
        )}
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 z-30 min-w-[200px] bg-popover border border-border rounded-md shadow-lg p-1 animate-in fade-in zoom-in-95 duration-150 origin-top-left">
          {transitions.isLoading ? (
            <div className="px-3 py-2 text-xs text-muted-foreground inline-flex items-center gap-2">
              <Loader2 size={12} className="animate-spin" />{' '}
              {t('common.loading')}
            </div>
          ) : transitions.isError ? (
            <div className="px-3 py-2 text-xs text-destructive">
              {t('tasks.statusPicker.loadFailed')}
            </div>
          ) : !transitions.data || transitions.data.length === 0 ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">
              {t('tasks.statusPicker.noTransitions')}
            </div>
          ) : (
            transitions.data.map((tr) => (
              <button
                key={tr.id}
                onClick={() => onPick(tr.id)}
                disabled={apply.isPending}
                className="w-full text-left px-2 py-1.5 rounded text-xs hover:bg-accent flex items-center justify-between gap-2"
              >
                <span>{tr.name}</span>
                {tr.toStatus && tr.toStatus !== tr.name && (
                  <span className="text-[10px] text-muted-foreground">
                    → {tr.toStatus}
                  </span>
                )}
              </button>
            ))
          )}
          {apply.error && (
            <div className="px-2 py-1 text-[11px] text-destructive">
              {apply.error.message}
            </div>
          )}
        </div>
      )}
    </span>
  )
}

/**
 * Assignee row с возможностью переассайнить. Клик по строке
 * открывает search-as-you-type. Кнопка "Unassign" — отвязать.
 */
function AssigneePicker({ issueKey, person }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  // Без query загружаем весь assignable-список этой задачи. Сервер
  // сам фильтрует по project-permissions, и при печати в input —
  // дополнительно по имени/email. Min-char ограничения нет, lock'а
  // на 2 символа тоже.
  const assignable = useJiraAssignableUsers(issueKey, query, {
    enabled: open
  })
  const setAssignee = useSetJiraAssignee(issueKey)
  const ref = useClickOutside(() => {
    setOpen(false)
    setQuery('')
  })
  const onPick = async (accountId) => {
    try {
      await setAssignee.mutateAsync(accountId)
      setOpen(false)
      setQuery('')
    } catch {
      // ошибка осядет в setAssignee.error
    }
  }
  return (
    <li ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={setAssignee.isPending}
        className="flex items-center gap-2.5 w-full text-left rounded -mx-1 px-1 py-0.5 hover:bg-accent/40 disabled:opacity-60"
        title={t('tasks.assigneePicker.tooltip')}
      >
        <Avatar name={person?.displayName || null} size={24} />
        <div className="text-xs leading-tight flex-1">
          {person ? (
            <>
              <strong className="text-foreground/90">
                {person.displayName}
              </strong>
              <span className="text-muted-foreground">
                {' '}· {t('tasks.role.assignee')}
              </span>
            </>
          ) : (
            <span className="text-muted-foreground">
              {t('tasks.role.unassigned', {
                role: t('tasks.role.assignee')
              })}
            </span>
          )}
        </div>
        {setAssignee.isPending ? (
          <Loader2 size={11} className="animate-spin text-muted-foreground" />
        ) : (
          <Pencil
            size={11}
            className="text-muted-foreground/50 group-hover:text-foreground"
          />
        )}
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 z-30 w-[20rem] bg-popover border border-border rounded-md shadow-lg p-2 space-y-1 animate-in fade-in zoom-in-95 duration-150 origin-top-left">
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('tasks.assigneePicker.placeholder')}
            className="h-8 text-xs"
          />
          <div className="max-h-64 overflow-auto">
            {assignable.isLoading ? (
              <div className="px-2 py-1.5 text-[11px] text-muted-foreground inline-flex items-center gap-2">
                <Loader2 size={11} className="animate-spin" />{' '}
                {t('tasks.assigneePicker.loading')}
              </div>
            ) : assignable.isError ? (
              <div className="px-2 py-1.5 text-[11px] text-destructive">
                {t('tasks.assigneePicker.searchFailed')}
              </div>
            ) : !assignable.data || assignable.data.length === 0 ? (
              <div className="px-2 py-1.5 text-[11px] text-muted-foreground">
                {query.trim()
                  ? t('tasks.assigneePicker.noMatches')
                  : t('tasks.assigneePicker.noAssignable')}
              </div>
            ) : (
              assignable.data.map((u) => (
                <button
                  key={u.accountId}
                  onClick={() => onPick(u.accountId)}
                  disabled={setAssignee.isPending}
                  className="w-full text-left px-2 py-1.5 rounded text-xs hover:bg-accent flex items-center gap-2"
                >
                  <Avatar name={u.displayName} size={20} />
                  <div className="flex-1 min-w-0">
                    <div className="truncate">{u.displayName}</div>
                    {u.emailAddress && (
                      <div className="text-[10px] text-muted-foreground truncate">
                        {u.emailAddress}
                      </div>
                    )}
                  </div>
                  {person?.accountId === u.accountId && (
                    <Check size={11} className="text-emerald-400" />
                  )}
                </button>
              ))
            )}
          </div>
          {person && (
            <button
              onClick={() => onPick(null)}
              disabled={setAssignee.isPending}
              className="w-full text-left px-2 py-1.5 rounded text-xs hover:bg-destructive/10 text-destructive border-t border-border/50 mt-1 pt-2"
            >
              {t('tasks.assigneePicker.unassign')}
            </button>
          )}
          {setAssignee.error && (
            <div className="px-2 py-1 text-[11px] text-destructive">
              {setAssignee.error.message}
            </div>
          )}
        </div>
      )}
    </li>
  )
}

/**
 * Форма добавления комментария. Cmd/Ctrl+Enter отправляет.
 */
function CommentForm({ issueKey }) {
  const t = useT()
  const [text, setText] = useState('')
  const addComment = useAddJiraComment(issueKey)
  const trimmed = text.trim()
  const send = async () => {
    if (!trimmed || addComment.isPending) return
    try {
      await addComment.mutateAsync(trimmed)
      setText('')
    } catch {
      // ошибка останется в addComment.error
    }
  }
  return (
    <div className="space-y-1.5 pt-1">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            send()
          }
        }}
        placeholder={t('tasks.commentForm.placeholder')}
        rows={3}
        className="w-full bg-background border border-input rounded-md px-3 py-2 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-y"
      />
      <div className="flex items-center justify-end gap-2">
        {addComment.error && (
          <span className="text-[11px] text-destructive flex-1 truncate">
            {addComment.error.message}
          </span>
        )}
        <Button
          size="sm"
          onClick={send}
          disabled={!trimmed || addComment.isPending}
          className="h-7"
        >
          {addComment.isPending ? (
            <Loader2 className="animate-spin" />
          ) : (
            <Send size={12} />
          )}
          {t('common.send')}
        </Button>
      </div>
    </div>
  )
}

/**
 * Одна строка людей: avatar слева, потом имя + роль через ·.
 * Layout идентичен строке комментария (avatar 24, gap-2.5, info
 * справа), чтобы Assignee/Reporter и комментарии визуально
 * выстраивались в одну колонку.
 */
function PersonRow({ role, person }) {
  const t = useT()
  return (
    <li className="flex items-center gap-2.5">
      <Avatar name={person?.displayName || null} size={24} />
      <div className="text-xs leading-tight">
        {person ? (
          <>
            <strong className="text-foreground/90">
              {person.displayName}
            </strong>
            <span className="text-muted-foreground"> · {role}</span>
          </>
        ) : (
          <span className="text-muted-foreground">
            {t('tasks.role.unassigned', { role })}
          </span>
        )}
      </div>
    </li>
  )
}

// Палитра для initials-аватаров: 8 неярких заливок, чтобы один и
// тот же юзер всегда был одного цвета (хешируем имя), но разные
// люди в комментах визуально отличались.
const AVATAR_COLORS = [
  'bg-sky-500/20 text-sky-300',
  'bg-emerald-500/20 text-emerald-300',
  'bg-amber-500/20 text-amber-300',
  'bg-rose-500/20 text-rose-300',
  'bg-violet-500/20 text-violet-300',
  'bg-cyan-500/20 text-cyan-300',
  'bg-orange-500/20 text-orange-300',
  'bg-pink-500/20 text-pink-300'
]

/**
 * Initials-аватарка. Берёт первые буквы первого и (если есть)
 * второго слова имени, заглавными. Цвет выбирается детерминированно
 * по hash имени — один и тот же юзер всегда одного цвета.
 */
export function Avatar({ name, size = 24 }) {
  if (!name) {
    return (
      <span
        style={{ width: size, height: size }}
        className="inline-flex items-center justify-center rounded-full bg-muted/60 text-muted-foreground shrink-0"
      >
        <span className="text-[10px]">?</span>
      </span>
    )
  }
  const parts = name.split(/\s+/).filter(Boolean)
  const initials = (parts[0]?.[0] || '') + (parts[1]?.[0] || '')
  const cleaned = initials.toUpperCase() || '?'
  const hash =
    [...name].reduce((acc, c) => acc + c.charCodeAt(0), 0) %
    AVATAR_COLORS.length
  return (
    <span
      style={{ width: size, height: size }}
      className={cn(
        'inline-flex items-center justify-center rounded-full font-medium shrink-0',
        AVATAR_COLORS[hash]
      )}
    >
      <span className="text-[10px]">{cleaned}</span>
    </span>
  )
}

export function StatusBadge({ category, label }) {
  const t = useT()
  const cfg = statusBadgeConfig(category)
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wide font-medium',
        cfg.cls
      )}
    >
      {label || t(cfg.fallbackKey)}
    </span>
  )
}

function statusBadgeConfig(category) {
  switch (category) {
    case 'new':
      return {
        fallbackKey: 'tasks.status.toDo',
        cls: 'bg-zinc-700/40 text-zinc-300'
      }
    case 'indeterminate':
      return {
        fallbackKey: 'tasks.status.inProgress',
        cls: 'bg-sky-500/20 text-sky-300'
      }
    case 'done':
      return {
        fallbackKey: 'tasks.status.done',
        cls: 'bg-emerald-500/20 text-emerald-300'
      }
    default:
      return {
        fallbackKey: 'tasks.status.fallback',
        cls: 'bg-muted/50 text-muted-foreground'
      }
  }
}

export function OpenInJiraLink({ issueKey, className }) {
  const t = useT()
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
      {t('tasks.detail.openInJira')} <ExternalLink size={10} />
    </button>
  )
}

/**
 * Бейдж "slug mismatch" — экспортируется отдельно для использования
 * в Tasks-табе drawer'а проекта. Маленький предупредительный
 * элемент с tooltip какого slug'а упомянуто.
 */
export function SlugMismatchBadge({ mentioned }) {
  const t = useT()
  if (!mentioned || mentioned.length === 0) return null
  const tooltip = t('tasks.mismatch.tooltip', {
    slugs: mentioned.join(', ')
  })
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
