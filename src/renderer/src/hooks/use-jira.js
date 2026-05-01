import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import { api } from '@/api'

const ONE_MIN = 60 * 1000
const TWO_MIN = 2 * 60 * 1000
const FIVE_MIN = 5 * 60 * 1000
const HALF_HOUR = 30 * 60 * 1000

/**
 * Список доступных юзеру Jira-проектов. Кэш длинный — проекты
 * меняются редко. По refetch'у тот же ключ; ручной "Refresh
 * projects" в Settings вызывает projectsRefresh API напрямую.
 */
export function useJiraProjects() {
  return useQuery({
    queryKey: ['jira', 'projects'],
    queryFn: () => api.jira.projects(),
    staleTime: HALF_HOUR,
    retry: false
  })
}

/**
 * Свои незакрытые таски — один JQL на все доступные проекты,
 * Jira фильтрует по правам автоматически. Live-ish: 1 мин stale.
 */
export function useMyJiraIssues(opts = {}) {
  return useQuery({
    queryKey: ['jira', 'my-issues', opts.maxResults ?? 50],
    queryFn: () =>
      api.jira.myIssues({ maxResults: opts.maxResults ?? 50 }),
    enabled: opts.enabled !== false,
    staleTime: ONE_MIN,
    retry: false
  })
}

/**
 * Незакрытые таски конкретного проекта (по Jira project key).
 * Используется в Tasks-табе drawer'а после резолва slug→key.
 */
export function useProjectJiraIssues(projectKey, opts = {}) {
  return useQuery({
    queryKey: ['jira', 'project-issues', projectKey],
    queryFn: () =>
      api.jira.projectIssues(projectKey, {
        maxResults: opts.maxResults ?? 50
      }),
    enabled:
      opts.enabled !== false &&
      typeof projectKey === 'string' &&
      projectKey.length > 0,
    staleTime: ONE_MIN,
    retry: false
  })
}

/**
 * Закрытые таски проекта — для секции "Recently done" в
 * Tasks-табе. Долгий staleTime (5 мин): закрытые таски не
 * меняются часто, а опросом дёргать не хочется.
 */
export function useProjectClosedJiraIssues(projectKey, opts = {}) {
  return useQuery({
    queryKey: ['jira', 'project-closed', projectKey],
    queryFn: () =>
      api.jira.projectClosedIssues(projectKey, {
        maxResults: opts.maxResults ?? 10
      }),
    enabled:
      opts.enabled !== false &&
      typeof projectKey === 'string' &&
      projectKey.length > 0,
    staleTime: FIVE_MIN,
    retry: false
  })
}

/**
 * Деталь одной задачи (description + последние 5 комментариев).
 * Lazy: enabled управляется родителем (раскрытие в списке /
 * открытие detail-drawer'а).
 */
export function useJiraIssueDetail(issueKey, opts = {}) {
  return useQuery({
    queryKey: ['jira', 'issue-detail', issueKey],
    queryFn: () => api.jira.issueDetail(issueKey),
    enabled:
      opts.enabled !== false &&
      typeof issueKey === 'string' &&
      issueKey.length > 0,
    staleTime: TWO_MIN,
    retry: false
  })
}

/**
 * Резолв Bitbucket slug → Jira project. Маппинг по префиксу
 * имени Jira-проекта: например "p0066- Zeiad Jewellery (Amjad)"
 * матчится со slug'ом "p0066". Сравнение case-insensitive,
 * разделитель — любой не-alnum символ или конец строки.
 *
 * Возвращает первое совпадение или null. Использует кэш
 * useJiraProjects — отдельных запросов не делает.
 *
 * @param {string | null | undefined} slug
 * @returns {{
 *   project: { key: string, name: string } | null,
 *   isLoading: boolean,
 *   isError: boolean
 * }}
 */
export function useJiraProjectForSlug(slug) {
  const projectsQuery = useJiraProjects()
  const matched = useMemo(() => {
    if (!slug || !projectsQuery.data) return null
    return findProjectForSlug(projectsQuery.data, slug)
  }, [slug, projectsQuery.data])
  return {
    project: matched,
    isLoading: projectsQuery.isLoading,
    isError: projectsQuery.isError
  }
}

/**
 * Доступные переходы статуса для конкретной задачи. Отдельный
 * запрос (Atlassian не возвращает их вместе с issue detail).
 * Lazy: dropdown открывается по клику на статус-бейдж, тогда
 * родитель ставит enabled=true.
 */
export function useJiraTransitions(issueKey, opts = {}) {
  return useQuery({
    queryKey: ['jira', 'transitions', issueKey],
    queryFn: () => api.jira.transitions(issueKey),
    enabled:
      opts.enabled !== false &&
      typeof issueKey === 'string' &&
      issueKey.length > 0,
    staleTime: 60 * 1000,
    retry: false
  })
}

/**
 * Список юзеров, доступных для назначения на конкретную issue.
 * Без query — весь assignable-список (фильтрованный сервером по
 * project-permissions). С query — сервер дополнительно фильтрует
 * по имени/email. Используется assignee picker'ом: при открытии
 * показывается полный список, при печати фильтруется.
 */
export function useJiraAssignableUsers(issueKey, query, opts = {}) {
  const q = (query || '').trim()
  return useQuery({
    queryKey: ['jira', 'assignable', issueKey, q.toLowerCase()],
    queryFn: () => api.jira.assignableUsers(issueKey, q),
    enabled:
      opts.enabled !== false &&
      typeof issueKey === 'string' &&
      issueKey.length > 0,
    staleTime: 60 * 1000,
    retry: false
  })
}

/**
 * Универсальный invalidator для одной issue. После любого write'а
 * (комментарий / assignee / transition) обновляем issue-detail и
 * связанные списки, чтобы UI тут же увидел изменение.
 */
function buildInvalidate(queryClient, issueKey) {
  return () => {
    queryClient.invalidateQueries({
      queryKey: ['jira', 'issue-detail', issueKey]
    })
    queryClient.invalidateQueries({
      queryKey: ['jira', 'transitions', issueKey]
    })
    queryClient.invalidateQueries({ queryKey: ['jira', 'my-issues'] })
    queryClient.invalidateQueries({
      queryKey: ['jira', 'project-issues']
    })
    queryClient.invalidateQueries({
      queryKey: ['jira', 'project-closed']
    })
  }
}

/**
 * Добавить комментарий к задаче.
 */
export function useAddJiraComment(issueKey) {
  const queryClient = useQueryClient()
  const invalidate = buildInvalidate(queryClient, issueKey)
  return useMutation({
    mutationFn: (body) => api.jira.addComment(issueKey, body),
    onSuccess: invalidate
  })
}

/**
 * Сменить assignee. accountId === null отвязывает (unassigned).
 */
export function useSetJiraAssignee(issueKey) {
  const queryClient = useQueryClient()
  const invalidate = buildInvalidate(queryClient, issueKey)
  return useMutation({
    mutationFn: (accountId) => api.jira.setAssignee(issueKey, accountId),
    onSuccess: invalidate
  })
}

/**
 * Применить transition (изменить статус).
 */
export function useApplyJiraTransition(issueKey) {
  const queryClient = useQueryClient()
  const invalidate = buildInvalidate(queryClient, issueKey)
  return useMutation({
    mutationFn: (transitionId) =>
      api.jira.applyTransition(issueKey, transitionId),
    onSuccess: invalidate
  })
}

/**
 * Reverse-направление маппинга: из Jira-имени проекта вытащить
 * Bitbucket slug. Берём ведущую alnum-последовательность до
 * первого не-alnum символа, lowercase. Так "p0066- Zeiad Jewellery
 * (Amjad)" → "p0066"; "PZJA Project (123)" → "pzja"; "WikiOnly"
 * → "wikionly". Caller сам проверяет, есть ли такой slug среди
 * известных Bitbucket-репо.
 *
 * @param {string} name
 * @returns {string|null}
 */
export function parseSlugFromProjectName(name) {
  if (!name || typeof name !== 'string') return null
  const m = name.trim().match(/^([a-z0-9]+)(?:[^a-z0-9].*)?$/i)
  return m ? m[1].toLowerCase() : null
}

/**
 * Чистая функция matching'а — экспортируется для тестов и для
 * использования в других хуках (mismatch detector). Строгий
 * префикс: имя Jira-проекта должно начинаться с slug'а
 * (case-insensitive), и сразу за ним должен идти не-alnum
 * символ либо конец строки. Так "p0066- Zeiad" матчит "p0066",
 * но "p00669-foo" — нет, и "p0066alfa" — нет.
 *
 * @param {Array<{ key: string, name: string }>} projects
 * @param {string} slug
 */
export function findProjectForSlug(projects, slug) {
  if (!slug || !Array.isArray(projects)) return null
  const lower = slug.toLowerCase()
  const escaped = lower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`^${escaped}(?:[^a-z0-9].*)?$`, 'i')
  for (const p of projects) {
    if (!p?.name) continue
    if (re.test(p.name.trim())) return p
  }
  return null
}

/**
 * Поиск slug'ов, упомянутых в произвольном тексте (summary,
 * description). Возвращает массив найденных slug'ов
 * (case-insensitive, дедуп). Используется для "slug mismatch"
 * пометки: если в title таска упомянут slug, отличный от
 * Jira-проекта, в котором живёт таск — флажок.
 *
 * Матчинг строгий: slug должен быть окружён не-alnum символами
 * с обеих сторон (или быть на границе строки), чтобы p0066
 * не ловило "p00669".
 *
 * @param {string} text
 * @param {string[]} knownSlugs
 */
export function findSlugMentions(text, knownSlugs) {
  if (!text || !Array.isArray(knownSlugs) || knownSlugs.length === 0) {
    return []
  }
  const lower = text.toLowerCase()
  const found = new Set()
  for (const slug of knownSlugs) {
    if (!slug) continue
    const escaped = slug
      .toLowerCase()
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(`(^|[^a-z0-9])${escaped}(?=[^a-z0-9]|$)`, 'i')
    if (re.test(lower)) found.add(slug.toLowerCase())
  }
  return [...found]
}
