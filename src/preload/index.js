import { contextBridge, ipcRenderer } from 'electron'

/**
 * Тонкие обёртки IPC. Каждый неймспейс отражает раздел 6 спеки.
 * Реализации в main/services/* подключаются по мере MVP.
 *
 * @typedef {import('../shared/types.js').Project} Project
 * @typedef {import('../shared/types.js').AppConfig} AppConfig
 */

const api = {
  sources: {
    list: () => ipcRenderer.invoke('sources:list'),
    add: (payload) => ipcRenderer.invoke('sources:add', payload),
    update: (id, patch) => ipcRenderer.invoke('sources:update', id, patch),
    remove: (id) => ipcRenderer.invoke('sources:remove', id),
    test: (id) => ipcRenderer.invoke('sources:test', id),
    setSecret: (id, token) =>
      ipcRenderer.invoke('sources:setSecret', id, token),
    clearSecret: (id) => ipcRenderer.invoke('sources:clearSecret', id)
  },
  databases: {
    list: () => ipcRenderer.invoke('databases:list'),
    add: (payload) => ipcRenderer.invoke('databases:add', payload),
    update: (id, patch) =>
      ipcRenderer.invoke('databases:update', id, patch),
    remove: (id) => ipcRenderer.invoke('databases:remove', id),
    test: (id) => ipcRenderer.invoke('databases:test', id),
    setSecret: (id, password) =>
      ipcRenderer.invoke('databases:setSecret', id, password),
    clearSecret: (id) => ipcRenderer.invoke('databases:clearSecret', id),
    listDbNames: (id) => ipcRenderer.invoke('databases:listDbNames', id),
    detectForProject: (slug) =>
      ipcRenderer.invoke('databases:detectForProject', slug)
  },
  // VCS-операции (provider-agnostic). Раньше неймспейс был
  // api.bitbucket; сейчас api.vcs — каналы и логика одинаково обслуживают
  // любой настроенный source (BB, GH, в будущем GitLab и т.д.).
  // Pipelines BB / Actions GH унифицированы как «builds».
  vcs: {
    list: () => ipcRenderer.invoke('vcs:projects:list'),
    refresh: () => ipcRenderer.invoke('vcs:projects:refresh'),
    testConnection: () => ipcRenderer.invoke('vcs:test'),
    lastCommit: (slug) => ipcRenderer.invoke('vcs:lastCommit', slug),
    commits: (slug, opts) =>
      ipcRenderer.invoke('vcs:commits', slug, opts),
    commitDetail: (slug, hash) =>
      ipcRenderer.invoke('vcs:commit-detail', slug, hash),
    commitFileDiff: (slug, hash, path) =>
      ipcRenderer.invoke('vcs:commit-file-diff', slug, hash, path),
    builds: (slug, opts) =>
      ipcRenderer.invoke('vcs:builds', slug, opts),
    buildSteps: (slug, buildUuid) =>
      ipcRenderer.invoke('vcs:build-steps', slug, buildUuid),
    buildStepLog: (slug, buildUuid, stepUuid) =>
      ipcRenderer.invoke('vcs:build-step-log', slug, buildUuid, stepUuid),
    branches: (slug) => ipcRenderer.invoke('vcs:branches', slug)
  },
  git: {
    clone: (slug) => ipcRenderer.invoke('git:clone', slug),
    pull: (slug) => ipcRenderer.invoke('git:pull', slug),
    status: (slug) => ipcRenderer.invoke('git:status', slug),
    branches: (slug) => ipcRenderer.invoke('git:branches', slug),
    checkout: (slug, branch) =>
      ipcRenderer.invoke('git:checkout', slug, branch)
  },
  db: {
    testConnection: () => ipcRenderer.invoke('db:test'),
    create: (name) => ipcRenderer.invoke('db:create', name),
    drop: (name) => ipcRenderer.invoke('db:drop', name),
    restore: (slug, dumpPath) =>
      ipcRenderer.invoke('db:restore', { slug, dumpPath }),
    isRestoring: (slug) => ipcRenderer.invoke('db:isRestoring', slug),
    /**
     * Подписка на db:restore-event.
     * Возвращает unsubscribe.
     */
    onRestore: (callback) => {
      const handler = (_e, payload) => callback(payload)
      ipcRenderer.on('db:restore-event', handler)
      return () => ipcRenderer.removeListener('db:restore-event', handler)
    }
  },
  fs: {
    findDump: (slug) => ipcRenderer.invoke('fs:findDump', slug),
    pickDump: () => ipcRenderer.invoke('fs:pickDump'),
    projectExists: (slug) => ipcRenderer.invoke('fs:projectExists', slug)
  },
  process: {
    run: (slug) => ipcRenderer.invoke('process:run', slug),
    stop: (slug) => ipcRenderer.invoke('process:stop', slug),
    isRunning: (slug) => ipcRenderer.invoke('process:isRunning', slug),
    list: () => ipcRenderer.invoke('process:list'),
    logs: (slug) => ipcRenderer.invoke('process:logs', slug),
    detectRunCommand: (slug) =>
      ipcRenderer.invoke('process:detectRunCommand', slug),
    /**
     * Подписка на process:log/port/exit.
     * Возвращает unsubscribe.
     * @param {'log'|'port'|'exit'} event
     * @param {(payload:any)=>void} callback
     */
    on: (event, callback) => {
      const channel = `process:${event}`
      const handler = (_e, payload) => callback(payload)
      ipcRenderer.on(channel, handler)
      return () => ipcRenderer.removeListener(channel, handler)
    }
  },
  editor: {
    openInVSCode: (slug) => ipcRenderer.invoke('editor:openInVSCode', slug)
  },
  config: {
    get: () => ipcRenderer.invoke('config:get'),
    set: (patch) => ipcRenderer.invoke('config:set', patch),
    setSecret: (key, value) => ipcRenderer.invoke('config:setSecret', key, value),
    clearSecret: (key) => ipcRenderer.invoke('config:clearSecret', key),
    secretsStatus: () => ipcRenderer.invoke('config:secretsStatus'),
    whichBinary: (name) => ipcRenderer.invoke('config:whichBinary', name)
  },
  setup: {
    runFull: (params) => ipcRenderer.invoke('setup:run-full', params),
    cancel: (slug) => ipcRenderer.invoke('setup:cancel', slug),
    isActive: (slug) => ipcRenderer.invoke('setup:is-active', slug),
    detectStack: (slug) => ipcRenderer.invoke('setup:detectStack', slug),
    on: (callback) => {
      const handler = (_e, payload) => callback(payload)
      ipcRenderer.on('setup:event', handler)
      return () => ipcRenderer.removeListener('setup:event', handler)
    }
  },
  updater: {
    quitAndInstall: () => ipcRenderer.invoke('updater:quit-and-install'),
    on: (callback) => {
      const handler = (_e, payload) => callback(payload)
      ipcRenderer.on('updater:event', handler)
      return () => ipcRenderer.removeListener('updater:event', handler)
    }
  },
  app: {
    openFolder: (path) => ipcRenderer.invoke('app:openFolder', path),
    deleteProjectLocal: (slug) =>
      ipcRenderer.invoke('app:deleteProjectLocal', slug)
  },
  presence: {
    list: () => ipcRenderer.invoke('presence:list'),
    isEnabled: () => ipcRenderer.invoke('presence:isEnabled'),
    setEnabled: (on) => ipcRenderer.invoke('presence:setEnabled', on)
  },
  jira: {
    testConnection: () => ipcRenderer.invoke('jira:test'),
    projects: () => ipcRenderer.invoke('jira:projects'),
    projectsRefresh: () => ipcRenderer.invoke('jira:projects:refresh'),
    myIssues: (opts) => ipcRenderer.invoke('jira:my-issues', opts),
    projectIssues: (projectKey, opts) =>
      ipcRenderer.invoke('jira:project-issues', projectKey, opts),
    projectClosedIssues: (projectKey, opts) =>
      ipcRenderer.invoke('jira:project-closed-issues', projectKey, opts),
    issueDetail: (issueKey) =>
      ipcRenderer.invoke('jira:issue-detail', issueKey),
    issueUrl: (issueKey) => ipcRenderer.invoke('jira:issue-url', issueKey),
    addComment: (issueKey, body) =>
      ipcRenderer.invoke('jira:add-comment', issueKey, body),
    setAssignee: (issueKey, accountId) =>
      ipcRenderer.invoke('jira:set-assignee', issueKey, accountId),
    transitions: (issueKey) =>
      ipcRenderer.invoke('jira:transitions', issueKey),
    applyTransition: (issueKey, transitionId) =>
      ipcRenderer.invoke('jira:apply-transition', issueKey, transitionId),
    assignableUsers: (issueKey, query) =>
      ipcRenderer.invoke('jira:assignable-users', issueKey, query)
  }
}

contextBridge.exposeInMainWorld('api', api)
