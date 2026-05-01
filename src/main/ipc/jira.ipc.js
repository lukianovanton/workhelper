import { ipcMain } from 'electron'
import {
  testConnection,
  listProjects,
  getMyIssues,
  getProjectIssues,
  getIssueDetail,
  buildIssueUrl,
  addComment,
  setAssignee,
  getTransitions,
  applyTransition,
  searchAssignableUsers
} from '../services/jira-client.js'

/**
 * Регистрация jira:* IPC-каналов.
 *
 *  - jira:test            проверка коннекта (auth + projects access)
 *  - jira:projects        список доступных Jira-проектов (cached 10 мин)
 *  - jira:projects:refresh принудительный обход кэша
 *  - jira:my-issues       свои незакрытые задачи через все проекты
 *  - jira:project-issues  незакрытые задачи одного проекта (по key)
 *  - jira:issue-detail    деталь задачи (description + последние 5 коммитов)
 *  - jira:issue-url       подсказка URL на view (renderer не знает host'а)
 */
export function registerJiraIpc() {
  ipcMain.handle('jira:test', () => testConnection())
  ipcMain.handle('jira:projects', () => listProjects(false))
  ipcMain.handle('jira:projects:refresh', () => listProjects(true))
  ipcMain.handle('jira:my-issues', (_event, opts) => getMyIssues(opts))
  ipcMain.handle('jira:project-issues', (_event, projectKey, opts) =>
    getProjectIssues(projectKey, opts)
  )
  ipcMain.handle('jira:issue-detail', (_event, issueKey) =>
    getIssueDetail(issueKey)
  )
  ipcMain.handle('jira:issue-url', (_event, issueKey) =>
    buildIssueUrl(issueKey)
  )
  ipcMain.handle('jira:add-comment', (_event, issueKey, body) =>
    addComment(issueKey, body)
  )
  ipcMain.handle('jira:set-assignee', (_event, issueKey, accountId) =>
    setAssignee(issueKey, accountId)
  )
  ipcMain.handle('jira:transitions', (_event, issueKey) =>
    getTransitions(issueKey)
  )
  ipcMain.handle('jira:apply-transition', (_event, issueKey, transitionId) =>
    applyTransition(issueKey, transitionId)
  )
  ipcMain.handle(
    'jira:assignable-users',
    (_event, issueKey, query) => searchAssignableUsers(issueKey, query)
  )
}
