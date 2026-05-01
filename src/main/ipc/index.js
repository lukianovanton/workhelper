import { registerConfigIpc } from './config.ipc.js'
import { registerBitbucketIpc } from './bitbucket.ipc.js'
import { registerDbIpc } from './db.ipc.js'
import { registerEditorIpc } from './editor.ipc.js'
import { registerFsIpc } from './fs.ipc.js'
import { registerGitIpc } from './git.ipc.js'
import { registerProcessIpc } from './process.ipc.js'
import { registerSetupIpc } from './setup.ipc.js'
import { registerAppIpc } from './app.ipc.js'
import { registerPresenceIpc } from './presence.ipc.js'
import { registerJiraIpc } from './jira.ipc.js'

/**
 * Регистрация всех IPC-хендлеров. Вызывается из main/index.js
 * после app.whenReady() — safeStorage и app.getPath() требуют готовности.
 */
export function registerAllIpc() {
  registerConfigIpc()
  registerBitbucketIpc()
  registerDbIpc()
  registerEditorIpc()
  registerFsIpc()
  registerGitIpc()
  registerProcessIpc()
  registerSetupIpc()
  registerAppIpc()
  registerPresenceIpc()
  registerJiraIpc()
}
