/**
 * Node-related dependency helpers, выделены отдельным модулем.
 *
 *   - resolvePackageManager(repoPath) → { pmName, hasPackageJson, hasNodeModules }
 *   - runPmCommand(repoPath, pmName, args) → Promise<{ code, stderrTail, stdoutTail }>
 *
 * Намеренно НЕТ project-specific логики (списка sass/less/etc.) —
 * setup делает только стандартный `<pm> install`. Если у проекта
 * битый package.json (отсутствуют peer-deps типа sass для sass-loader),
 * это бага автора проекта; WorkHelper её не патчит. Юзер увидит
 * причину через exit-toast и решит сам (PR в проект / `npm i -D <pkg>`).
 */

import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'

/**
 * @param {string} repoPath
 * @returns {{ pmName: 'npm'|'pnpm'|'yarn', hasPackageJson: boolean, hasNodeModules: boolean }}
 */
export function resolvePackageManager(repoPath) {
  const hasPackageJson = !!repoPath && fs.existsSync(path.join(repoPath, 'package.json'))
  const hasNodeModules = !!repoPath && fs.existsSync(path.join(repoPath, 'node_modules'))
  let pmName = 'npm'
  if (hasPackageJson) {
    if (fs.existsSync(path.join(repoPath, 'pnpm-lock.yaml'))) pmName = 'pnpm'
    else if (fs.existsSync(path.join(repoPath, 'yarn.lock'))) pmName = 'yarn'
  }
  return { pmName, hasPackageJson, hasNodeModules }
}

/**
 * Запускает `<pm> <args>` в repoPath. На Windows через shell:true
 * (npm/pnpm/yarn — `.cmd`-шимы; см. CVE-2024-27980), на POSIX direct exec.
 *
 * @returns {Promise<{ code: number|null, stderrTail: string, stdoutTail: string }>}
 */
export function runPmCommand(repoPath, pmName, args) {
  const isWin = process.platform === 'win32'
  let stderrTail = ''
  let stdoutTail = ''
  return new Promise((resolve, reject) => {
    let child
    const cmdline = [pmName, ...args].join(' ')
    try {
      child = isWin
        ? spawn(cmdline, [], {
            cwd: repoPath,
            shell: true,
            windowsHide: true,
            env: process.env
          })
        : spawn(pmName, args, {
            cwd: repoPath,
            shell: false,
            windowsHide: true,
            env: process.env
          })
    } catch (e) {
      reject(e)
      return
    }
    child.stdout?.on('data', (d) => {
      stdoutTail = (stdoutTail + d.toString()).slice(-2000)
    })
    child.stderr?.on('data', (d) => {
      stderrTail = (stderrTail + d.toString()).slice(-2000)
    })
    child.once('error', (err) => reject(err))
    child.once('exit', (code) => resolve({ code, stderrTail, stdoutTail }))
  })
}
