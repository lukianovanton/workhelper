/**
 * Список IPC-каналов. Документация для глаза разработчика —
 * preload и main-handler'ы используют свои литералы напрямую.
 *
 * Переименование (post-rename pass):
 *   bitbucket:* → vcs:*  (provider-agnostic; роутится по slug → registry)
 *   bitbucket:pipelines → vcs:builds (pipelines BB / Actions GH)
 */
export const IPC = {
  vcs: {
    list: 'vcs:projects:list',
    refresh: 'vcs:projects:refresh',
    test: 'vcs:test',
    lastCommit: 'vcs:lastCommit',
    commits: 'vcs:commits',
    commitDetail: 'vcs:commit-detail',
    commitFileDiff: 'vcs:commit-file-diff',
    branches: 'vcs:branches',
    builds: 'vcs:builds',
    buildSteps: 'vcs:build-steps',
    buildStepLog: 'vcs:build-step-log'
  },
  sources: {
    list: 'sources:list',
    add: 'sources:add',
    update: 'sources:update',
    remove: 'sources:remove',
    test: 'sources:test',
    setSecret: 'sources:setSecret',
    clearSecret: 'sources:clearSecret'
  },
  databases: {
    list: 'databases:list',
    add: 'databases:add',
    update: 'databases:update',
    remove: 'databases:remove',
    test: 'databases:test',
    setSecret: 'databases:setSecret',
    clearSecret: 'databases:clearSecret',
    listDbNames: 'databases:listDbNames',
    detectForProject: 'databases:detectForProject'
  },
  git: {
    clone: 'git:clone',
    pull: 'git:pull',
    status: 'git:status',
    branches: 'git:branches',
    checkout: 'git:checkout'
  },
  db: {
    test: 'db:test',
    create: 'db:create',
    drop: 'db:drop',
    restore: 'db:restore',
    isRestoring: 'db:isRestoring',
    restoreEvent: 'db:restore-event'
  },
  fs: {
    findDump: 'fs:findDump',
    pickDump: 'fs:pickDump',
    projectExists: 'fs:projectExists'
  },
  process: {
    run: 'process:run',
    stop: 'process:stop',
    isRunning: 'process:isRunning',
    list: 'process:list',
    logs: 'process:logs',
    log: 'process:log',
    port: 'process:port',
    exit: 'process:exit',
    detectRunCommand: 'process:detectRunCommand'
  },
  editor: {
    openInVSCode: 'editor:openInVSCode'
  },
  config: {
    get: 'config:get',
    set: 'config:set',
    setSecret: 'config:setSecret',
    clearSecret: 'config:clearSecret',
    secretsStatus: 'config:secretsStatus',
    whichBinary: 'config:whichBinary'
  },
  setup: {
    runFull: 'setup:run-full',
    cancel: 'setup:cancel',
    isActive: 'setup:is-active',
    detectStack: 'setup:detectStack',
    event: 'setup:event'
  },
  updater: {
    quitAndInstall: 'updater:quit-and-install',
    event: 'updater:event'
  },
  presence: {
    list: 'presence:list',
    isEnabled: 'presence:isEnabled',
    setEnabled: 'presence:setEnabled'
  },
  jira: {
    test: 'jira:test',
    projects: 'jira:projects'
    // (не полный список — справочно)
  },
  app: {
    openFolder: 'app:openFolder',
    deleteProjectLocal: 'app:deleteProjectLocal'
  },
  meta: {
    get: 'meta:get',
    set: 'meta:set'
  }
}
