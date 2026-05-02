import { app, BrowserWindow, ipcMain, shell } from 'electron'
import electronUpdater from 'electron-updater'
import { join } from 'node:path'
import Store from 'electron-store'
import { registerAllIpc } from './ipc/index.js'
import { killAll as killAllProcesses } from './services/process-manager.js'
import { killAllRestores } from './services/db-service.js'
import {
  startPresence,
  stopPresence
} from './services/presence-service.js'
import { getConfig } from './services/config-store.js'
import { migrateLegacyBitbucketToken } from './services/secrets.js'

const { autoUpdater } = electronUpdater
const FOUR_HOURS = 4 * 60 * 60 * 1000

const isDev = !app.isPackaged

const windowStateStore = new Store({
  name: 'window-state',
  clearInvalidConfig: true
})

// Только один экземпляр приложения. Повторный запуск ярлыка/exe должен
// просто фокусировать существующее окно вместо открытия второго.
const singleInstance = app.requestSingleInstanceLock()
if (!singleInstance) {
  app.quit()
}

app.on('second-instance', () => {
  const win = BrowserWindow.getAllWindows()[0]
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.focus()
})

function createWindow() {
  const saved = windowStateStore.get('bounds') || {}
  const mainWindow = new BrowserWindow({
    width: saved.width || 1280,
    height: saved.height || 800,
    x: typeof saved.x === 'number' ? saved.x : undefined,
    y: typeof saved.y === 'number' ? saved.y : undefined,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0a0a0a',
    title: 'Project Hub',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (saved.maximized) mainWindow.maximize()

  // Сохраняем bounds на close. На resize/move дёргать каждый раз
  // не нужно — close ловится один раз при выходе.
  const persistBounds = () => {
    if (mainWindow.isDestroyed()) return
    const isMax = mainWindow.isMaximized()
    const bounds = isMax ? mainWindow.getNormalBounds() : mainWindow.getBounds()
    windowStateStore.set('bounds', { ...bounds, maximized: isMax })
  }
  mainWindow.on('close', persistBounds)

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.antonl.workhelper')
  }

  // Один раз на старте: миграция legacy секретов под per-source ключи.
  // safeStorage требует ready-app, поэтому делаем именно здесь.
  // Также форсим getConfig() чтобы migrateConfig() в config-store
  // прогнал legacy `bitbucket: {}` → `sources[0]`.
  getConfig()
  migrateLegacyBitbucketToken()

  registerAllIpc()
  setupAutoUpdater()
  // Presence стартует только если юзер включил его в Settings.
  // Toggle во время работы тоже будет вызывать start/stop через IPC.
  if (getConfig().presence?.enabled) {
    startPresence()
  }
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

/**
 * Авто-обновления через electron-updater + GitHub Releases.
 * Работает только в packaged-сборке: dev-режим не пакетный, проверка
 * там бессмысленна (yml-файлов рядом с бинарником нет).
 *
 * Дефолты autoDownload: true / autoInstallOnAppQuit: true оставлены —
 * обновление само скачивается в фоне, ставится при следующем перезапуске.
 *
 * Сетевые/HTTP-ошибки идут в console.warn — никаких popup'ов, чтобы
 * отсутствие интернета не пугало пользователя. Сборки без релизов на
 * GitHub просто не найдут update — это норма.
 */
function setupAutoUpdater() {
  if (!app.isPackaged) return

  autoUpdater.on('update-available', (info) => {
    console.log(`[updater] update ${info?.version} available, downloading…`)
    broadcastUpdaterEvent({ kind: 'available', version: info?.version })
  })

  autoUpdater.on('update-downloaded', (info) => {
    console.log(`[updater] update ${info?.version} ready to install`)
    broadcastUpdaterEvent({ kind: 'downloaded', version: info?.version })
  })

  autoUpdater.on('error', (err) => {
    console.warn('[updater] error:', err?.message || err)
  })

  ipcMain.handle('updater:quit-and-install', () => {
    autoUpdater.quitAndInstall()
  })

  // Стартовая проверка + переодическая каждые 4ч пока приложение живо
  autoUpdater
    .checkForUpdatesAndNotify()
    .catch((err) =>
      console.warn('[updater] initial check failed:', err?.message || err)
    )
  setInterval(() => {
    autoUpdater
      .checkForUpdatesAndNotify()
      .catch(() => {})
  }, FOUR_HOURS)
}

function broadcastUpdaterEvent(payload) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.webContents.isDestroyed()) {
      win.webContents.send('updater:event', payload)
    }
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Гасим все запущенные dotnet-процессы, mysql-restore'ы и presence
// при выходе. Иначе они переживают наш Electron — dotnet продолжает
// слушать порты, mysql может оставить недовосстановленную БД, а UDP-
// сокет presence не освободит порт.
app.on('before-quit', () => {
  killAllProcesses()
  killAllRestores()
  stopPresence()
})
