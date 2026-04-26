/**
 * Git операции через simple-git (раздел 9.2 спеки + статус).
 *
 *  - pull(slug)   — git pull, возвращает { updated, summary }
 *  - status(slug) — git status, возвращает { dirty, branch, ahead, behind }
 *
 * Обе бросают Error с осмысленным message; renderer показывает
 * inline-status. Никакого автоматического stash при dirty —
 * сообщаем, что делать руками.
 */

import simpleGit from 'simple-git'
import { getConfig } from './config-store.js'
import { projectExists, projectPath } from './fs-service.js'

function ensureClonedPath(slug) {
  const root = getConfig().paths.projectsRoot
  if (!root) {
    throw new Error('Projects folder not configured. Open Settings → Paths.')
  }
  if (!projectExists(root, slug)) {
    throw new Error(`${slug} is not cloned at ${projectPath(root, slug)}`)
  }
  return projectPath(root, slug)
}

/**
 * @param {string} slug
 * @returns {Promise<{updated: boolean, summary: string}>}
 */
export async function pull(slug) {
  const cwd = ensureClonedPath(slug)
  const git = simpleGit({ baseDir: cwd, maxConcurrentProcesses: 1 })

  let result
  try {
    result = await git.pull()
  } catch (e) {
    const raw = e?.message || String(e)
    if (/uncommitted|local changes|would be overwritten/i.test(raw)) {
      throw new Error(
        'Cannot pull: you have uncommitted changes. Commit or stash first.'
      )
    }
    if (/Could not resolve host|network|connection/i.test(raw)) {
      throw new Error('Cannot pull: network unreachable. Check connection.')
    }
    if (/Authentication failed|invalid credentials|denied/i.test(raw)) {
      throw new Error(
        'Cannot pull: git authentication failed. Re-check your credential helper.'
      )
    }
    throw new Error(`Pull failed: ${raw.split('\n')[0]}`)
  }

  const filesChanged = Array.isArray(result.files) ? result.files.length : 0
  const ins = Number(result.insertions || 0)
  const del = Number(result.deletions || 0)
  const updated = filesChanged > 0 || ins > 0 || del > 0

  let summary
  if (!updated) {
    summary = 'Already up to date'
  } else {
    const parts = []
    parts.push(`${filesChanged} file${filesChanged === 1 ? '' : 's'} changed`)
    if (ins) parts.push(`+${ins}`)
    if (del) parts.push(`−${del}`)
    summary = parts.join(', ')
  }

  return { updated, summary }
}

/**
 * @param {string} slug
 * @returns {Promise<{dirty: boolean, branch: string|null, ahead: number, behind: number}>}
 */
export async function status(slug) {
  const cwd = ensureClonedPath(slug)
  const git = simpleGit({ baseDir: cwd, maxConcurrentProcesses: 1 })
  const s = await git.status()
  return {
    dirty: !s.isClean(),
    branch: s.current || null,
    ahead: s.ahead || 0,
    behind: s.behind || 0
  }
}
