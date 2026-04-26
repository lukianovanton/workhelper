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
    pull: 'git:pull',
    status: 'git:status'
  },
  db: {
    list: 'db:list',
    exists: 'db:exists',
    size: 'db:size',
    test: 'db:test'
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
  }
}
