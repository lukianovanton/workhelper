import { contextBridge, ipcRenderer } from 'electron'

/**
 * Тонкие обёртки IPC. Каждый неймспейс отражает раздел 6 спеки.
 * Реализации в main/services/* подключаются по мере MVP.
 *
 * @typedef {import('../shared/types.js').Project} Project
 * @typedef {import('../shared/types.js').AppConfig} AppConfig
 */

const api = {
  bitbucket: {
    list: () => ipcRenderer.invoke('bitbucket:list'),
    refresh: () => ipcRenderer.invoke('bitbucket:refresh'),
    testConnection: () => ipcRenderer.invoke('bitbucket:test'),
    lastCommit: (slug) => ipcRenderer.invoke('bitbucket:lastCommit', slug),
    commits: (slug, opts) =>
      ipcRenderer.invoke('bitbucket:commits', slug, opts),
    commitDetail: (slug, hash) =>
      ipcRenderer.invoke('bitbucket:commit-detail', slug, hash),
    commitFileDiff: (slug, hash, path) =>
      ipcRenderer.invoke('bitbucket:commit-file-diff', slug, hash, path),
    pipelines: (slug, opts) =>
      ipcRenderer.invoke('bitbucket:pipelines', slug, opts),
    pipelineSteps: (slug, pipelineUuid) =>
      ipcRenderer.invoke('bitbucket:pipeline-steps', slug, pipelineUuid),
    pipelineStepLog: (slug, pipelineUuid, stepUuid) =>
      ipcRenderer.invoke(
        'bitbucket:pipeline-step-log',
        slug,
        pipelineUuid,
        stepUuid
      ),
    branches: (slug) => ipcRenderer.invoke('bitbucket:branches', slug)
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
    list: () => ipcRenderer.invoke('db:list'),
    exists: (name) => ipcRenderer.invoke('db:exists', name),
    size: (name) => ipcRenderer.invoke('db:size', name),
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
    openFolder: (path) => ipcRenderer.invoke('app:openFolder', path)
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
    issueDetail: (issueKey) =>
      ipcRenderer.invoke('jira:issue-detail', issueKey),
    issueUrl: (issueKey) => ipcRenderer.invoke('jira:issue-url', issueKey)
  }
}

contextBridge.exposeInMainWorld('api', api)
