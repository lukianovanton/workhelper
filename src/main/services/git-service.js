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
import path from 'node:path'
import fs from 'node:fs'
import { getConfig } from './config-store.js'
import { projectExists, projectPath } from './fs-service.js'

/**
 * Клонирует репо в projectsRoot/slug.toLowerCase().
 *
 * Аутентификация — на системном Git Credential Manager. Мы строим
 * URL вида https://{gitUsername}@bitbucket.org/{workspace}/{slug}.git
 * и вызываем git clone без -c, без extraHeader, без email:token в
 * URL. GCM (на Windows встроен) подхватывает кэшированные креды для
 * bitbucket.org так же, как при ручном `git clone` в терминале.
 *
 * Если GCM пуст — пользователь должен один раз клонировать любой
 * репо вручную в терминале, чтобы прокачать кэш кредов. Это и есть
 * текст auth-error message: даём ровно ту команду, что нужна.
 *
 * @param {string} slug
 * @returns {Promise<{path: string, url: string}>}
 */
export async function clone(slug) {
  const config = getConfig()
  const root = config.paths.projectsRoot
  if (!root) {
    throw new Error('Projects folder not configured. Open Settings → Paths.')
  }

  const target = path.join(root, slug.toLowerCase())
  if (fs.existsSync(target)) {
    throw new Error(
      `${slug} already exists at ${target}. Refresh the projects list to see it as cloned.`
    )
  }

  const gitUsername = config.bitbucket.gitUsername
  const workspace = config.bitbucket.workspace
  if (!gitUsername) {
    throw new Error(
      'Bitbucket username (for git) not configured. Open Settings → Bitbucket.'
    )
  }
  if (!workspace) {
    throw new Error(
      'Bitbucket workspace not configured. Open Settings → Bitbucket.'
    )
  }

  // Гарантируем существование parent-папки (projectsRoot)
  fs.mkdirSync(root, { recursive: true })

  const url = `https://${gitUsername}@bitbucket.org/${workspace}/${slug.toLowerCase()}.git`

  const git = simpleGit({ baseDir: root, maxConcurrentProcesses: 1 })

  try {
    await git.raw(['clone', '--progress', url, target])
  } catch (e) {
    const raw = e?.message || String(e)
    const firstLine =
      raw.split(/\r?\n/).find((l) => l.trim()) || raw

    if (
      /Authentication failed|invalid credentials|403|denied|could not read Username|terminal prompts disabled/i.test(
        raw
      )
    ) {
      throw new Error(
        `Clone failed: authentication. Run this once in terminal to cache credentials in Git Credential Manager:\n\n  git clone ${url}\n\nThen come back and retry.`
      )
    }
    if (/Could not resolve host|network|connection/i.test(raw)) {
      throw new Error('Clone failed: network unreachable. ' + firstLine)
    }
    if (/repository .* not found|404/i.test(raw)) {
      throw new Error(
        `Clone failed: repository not found at ${url}. Check workspace and slug.`
      )
    }
    if (/already exists/i.test(raw)) {
      throw new Error(`${slug} already exists at ${target}.`)
    }
    throw new Error(`Clone failed: ${firstLine}`)
  }

  return { path: target, url }
}

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
 * @returns {Promise<{current: string|null, all: string[]}>}
 */
export async function branches(slug) {
  const cwd = ensureClonedPath(slug)
  const git = simpleGit({ baseDir: cwd, maxConcurrentProcesses: 1 })
  const b = await git.branchLocal()
  return {
    current: b.current || null,
    all: Array.isArray(b.all) ? b.all : []
  }
}

/**
 * @param {string} slug
 * @param {string} branch
 */
export async function checkout(slug, branch) {
  if (!branch || typeof branch !== 'string') {
    throw new Error('Branch name is required')
  }
  const cwd = ensureClonedPath(slug)
  const git = simpleGit({ baseDir: cwd, maxConcurrentProcesses: 1 })
  try {
    await git.checkout(branch)
  } catch (e) {
    const raw = e?.message || String(e)
    if (/uncommitted|local changes|would be overwritten/i.test(raw)) {
      throw new Error(
        `Cannot switch to ${branch}: you have uncommitted changes. Commit or stash first.`
      )
    }
    throw new Error(`Checkout failed: ${raw.split('\n')[0]}`)
  }
  return { branch }
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
