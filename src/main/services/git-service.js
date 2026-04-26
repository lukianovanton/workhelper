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
import Store from 'electron-store'
import { getConfig } from './config-store.js'
import { getSecret } from './secrets.js'
import { projectExists, projectPath } from './fs-service.js'

const bitbucketCache = new Store({ name: 'bitbucket-cache' })

function getCachedRepo(slug) {
  const repos = bitbucketCache.get('repos')
  if (!Array.isArray(repos)) return null
  return repos.find((r) => r && r.slug === slug) || null
}

/**
 * Клонирует репо в projectsRoot/slug.toLowerCase().
 * Auth через http.extraHeader (Basic email:apiToken) — креды НЕ
 * уходят в .git/config клонированного репо, остаются только в нашем
 * safeStorage. Будущие git ops у пользователя есть credential helper
 * (подтверждено в MVP-1 — Pull работал без нашей инжекции).
 *
 * @param {string} slug
 * @returns {Promise<{path: string}>}
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

  const repo = getCachedRepo(slug)
  if (!repo) {
    throw new Error(
      `${slug} is not in the cached projects list. Refresh and try again.`
    )
  }
  const cloneUrl = repo.bitbucket?.cloneUrl
  if (!cloneUrl) {
    throw new Error(`No HTTPS clone URL for ${slug} from Bitbucket.`)
  }

  const username = config.bitbucket.username
  const token = getSecret('bitbucketApiToken')
  if (!username || !token) {
    throw new Error(
      'Bitbucket credentials not configured. Open Settings → Bitbucket.'
    )
  }

  // Гарантируем существование parent-папки (projectsRoot)
  fs.mkdirSync(root, { recursive: true })

  // Инжектим креды прямо в URL, а не через -c http.extraHeader.
  // На Windows extraHeader перебивается Git Credential Manager'ом
  // (если у пользователя в нём кэш для bitbucket.org), и git
  // отправляет старые креды → 401. URL-инжекция детерминированна:
  // git берёт юзера/пароль из URL и НЕ вызывает credential helper.
  // URL-класс сам percent-encode'ит спец-символы в email/токене.
  const authedUrl = new URL(cloneUrl)
  authedUrl.username = username
  authedUrl.password = token
  const authedUrlStr = authedUrl.toString()

  const git = simpleGit({
    baseDir: root,
    maxConcurrentProcesses: 1
  })

  try {
    await git.raw(['clone', '--progress', authedUrlStr, target])
  } catch (e) {
    let msg = e?.message || String(e)
    // Санитизация — токен и authed URL не должны утечь в UI/логи
    msg = msg.split(authedUrlStr).join(cloneUrl)
    if (token) {
      msg = msg.split(token).join('<TOKEN>')
      msg = msg.split(encodeURIComponent(token)).join('<TOKEN>')
    }
    const firstLine = msg.split(/\r?\n/).find((l) => l.trim()) || msg
    if (/Authentication failed|invalid credentials|403/i.test(msg)) {
      throw new Error(
        'Clone failed: Bitbucket rejected the API token. Verify it has scope read:repository:bitbucket and the email matches the Atlassian account. Git: ' +
          firstLine
      )
    }
    if (/Could not resolve host|network|connection/i.test(msg)) {
      throw new Error('Clone failed: network unreachable. ' + firstLine)
    }
    if (/already exists/i.test(msg)) {
      throw new Error(`${slug} already exists at ${target}.`)
    }
    throw new Error(`Clone failed: ${firstLine}`)
  }

  // Чистим remote URL от инжектированных кредов, чтобы они не лежали
  // в .git/config клонированного репозитория. Future Pull использует
  // глобальный credential helper (подтверждено в MVP-1).
  try {
    const local = simpleGit({ baseDir: target, maxConcurrentProcesses: 1 })
    await local.remote(['set-url', 'origin', cloneUrl])
  } catch (e) {
    // Не фатально — клон удался, пользователь может поправить руками.
    // В UI ничего не показываем, чтобы не путать после успеха.
    console.warn('[clone] failed to scrub creds from remote URL:', e?.message)
  }

  return { path: target }
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
