/**
 * Список IPC-каналов. Использовать как единственный источник правды
 * чтобы избежать рассинхрона между preload и main-handler'ами.
 */
export const IPC = {
  bitbucket: {
    list: 'bitbucket:list',
    refresh: 'bitbucket:refresh',
    test: 'bitbucket:test'
  },
  git: {
    pull: 'git:pull',
    status: 'git:status'
  },
  db: {
    list: 'db:list',
    exists: 'db:exists',
    size: 'db:size'
  },
  fs: {
    findDump: 'fs:findDump',
    pickDump: 'fs:pickDump',
    projectExists: 'fs:projectExists'
  },
  process: {
    run: 'process:run',
    stop: 'process:stop',
    isRunning: 'process:isRunning'
  },
  editor: {
    openInVSCode: 'editor:openInVSCode'
  },
  config: {
    get: 'config:get',
    set: 'config:set',
    setSecret: 'config:setSecret'
  }
}
