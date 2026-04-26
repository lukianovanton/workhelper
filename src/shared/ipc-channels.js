/**
 * Список IPC-каналов. Использовать как единственный источник правды,
 * чтобы избежать рассинхрона между preload и main-handler'ами.
 */
export const IPC = {
  bitbucket: {
    list: 'bitbucket:list',
    refresh: 'bitbucket:refresh',
    test: 'bitbucket:test',
    lastCommit: 'bitbucket:lastCommit'
  },
  git: {
    clone: 'git:clone',
    pull: 'git:pull',
    status: 'git:status'
  },
  db: {
    list: 'db:list',
    exists: 'db:exists',
    size: 'db:size',
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
    exit: 'process:exit'
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
    event: 'setup:event'
  },
  updater: {
    quitAndInstall: 'updater:quit-and-install',
    event: 'updater:event'
  }
}
