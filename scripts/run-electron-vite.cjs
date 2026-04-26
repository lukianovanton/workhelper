/**
 * Wrapper для electron-vite.
 *
 * Снимает ELECTRON_RUN_AS_NODE из env перед запуском, чтобы Electron
 * стартовал в режиме главного процесса с полным API. Эта переменная
 * глобально выставлена в системе пользователя для других целей —
 * её наличие заставляет Electron вести себя как plain Node, и
 * приложение падает на require('electron') → строка вместо API.
 *
 * fork() напрямую вызывает Node на bin-скрипт electron-vite — без шелла,
 * чтобы не ловить DEP0190 (shell:true + args).
 */

const { fork } = require('node:child_process')
const path = require('node:path')

delete process.env.ELECTRON_RUN_AS_NODE

const pkgPath = require.resolve('electron-vite/package.json')
const binPath = path.join(path.dirname(pkgPath), 'bin', 'electron-vite.js')

const child = fork(binPath, process.argv.slice(2), {
  stdio: 'inherit',
  env: process.env
})

child.on('exit', (code) => process.exit(code ?? 0))
child.on('error', (err) => {
  console.error('[run-electron-vite] failed to spawn:', err)
  process.exit(1)
})
