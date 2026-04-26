const { contextBridge, ipcRenderer } = require('electron')

/**
 * Тонкие обёртки IPC. Каждый неймспейс отражает раздел 6 спеки.
 * Реализации в main/services/* подключаются позже по мере MVP.
 *
 * @typedef {import('../shared/types.js').Project} Project
 * @typedef {import('../shared/types.js').AppConfig} AppConfig
 */

const api = {
  bitbucket: {
    list: () => ipcRenderer.invoke('bitbucket:list'),
    refresh: () => ipcRenderer.invoke('bitbucket:refresh'),
    testConnection: () => ipcRenderer.invoke('bitbucket:test')
  },
  git: {
    pull: (slug) => ipcRenderer.invoke('git:pull', slug),
    status: (slug) => ipcRenderer.invoke('git:status', slug)
  },
  db: {
    list: () => ipcRenderer.invoke('db:list'),
    exists: (name) => ipcRenderer.invoke('db:exists', name),
    size: (name) => ipcRenderer.invoke('db:size', name)
  },
  fs: {
    findDump: (slug) => ipcRenderer.invoke('fs:findDump', slug),
    pickDump: () => ipcRenderer.invoke('fs:pickDump'),
    projectExists: (slug) => ipcRenderer.invoke('fs:projectExists', slug)
  },
  process: {
    run: (slug) => ipcRenderer.invoke('process:run', slug),
    stop: (slug) => ipcRenderer.invoke('process:stop', slug),
    isRunning: (slug) => ipcRenderer.invoke('process:isRunning', slug)
  },
  editor: {
    openInVSCode: (slug) => ipcRenderer.invoke('editor:openInVSCode', slug)
  },
  config: {
    get: () => ipcRenderer.invoke('config:get'),
    set: (patch) => ipcRenderer.invoke('config:set', patch),
    setSecret: (key, value) => ipcRenderer.invoke('config:setSecret', key, value)
  }
}

contextBridge.exposeInMainWorld('api', api)
