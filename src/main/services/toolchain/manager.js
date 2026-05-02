/**
 * Toolchain manager — центральная точка для:
 *   - анализа проекта на требования к toolchain'у
 *   - сводки текущего состояния машины
 *   - расчёта дифа missing-tools
 *
 * Сами установки делегируются в подмодули (build-tools.js,
 * python.js, ../node-version.js для Volta+Node).
 *
 * Кэш-стратегии: getInstalledState кэшируем на 60 секунд per-process.
 * Detection requirements per-project не кэшируем — repo может
 * измениться (новый pull) между вызовами.
 */

import path from 'node:path'
import fs from 'node:fs'

import { getBuildToolsInfo } from './build-tools.js'
import { getPythonInfo } from './python.js'
import {
  detectRequiredNodeVersion,
  getSystemNodeVersion,
  getVoltaInfo,
  isNodeProject
} from '../node-version.js'

/**
 * Native-модули в Node, которые требуют C++ compiler + Python для
 * сборки через node-gyp. Список расширяемый; критерий — пакет имеет
 * binding.gyp / install-script запускающий node-gyp / постоянно
 * упоминается в gyp-проблемах.
 *
 * `node-gyp` сам тоже считаем maker'ом — если он в depTree, проект
 * собирает что-то нативное.
 */
export const NATIVE_BUILD_DEPS = [
  'node-sass', // Самый частый троттл: SASS через C++
  'node-gyp',
  'bcrypt',
  'sharp',
  'canvas',
  'sqlite3',
  'better-sqlite3',
  'grpc',
  '@grpc/grpc-js', // частично-нативный, иногда нужен compiler
  'node-pty',
  'serialport',
  'sodium-native',
  'iohook',
  'robotjs',
  'keytar',
  'fibers',
  're2'
]

/**
 * @typedef {Object} ProjectRequirements
 * @property {boolean} isNodeProject
 * @property {{
 *   required: { version: string, source: string, raw: string } | null,
 *   nativeDeps: string[]    список нативных пакетов из package.json
 * }} node
 */

/**
 * @param {string} repoPath
 * @returns {ProjectRequirements}
 */
export function detectProjectRequirements(repoPath) {
  if (!repoPath) {
    return {
      isNodeProject: false,
      node: { required: null, nativeDeps: [] }
    }
  }
  const isNode = isNodeProject(repoPath)
  if (!isNode) {
    return {
      isNodeProject: false,
      node: { required: null, nativeDeps: [] }
    }
  }
  const required = detectRequiredNodeVersion(repoPath)
  let nativeDeps = []
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(repoPath, 'package.json'), 'utf8')
    )
    const allDeps = {
      ...(pkg.dependencies || {}),
      ...(pkg.devDependencies || {}),
      ...(pkg.optionalDependencies || {})
    }
    nativeDeps = Object.keys(allDeps).filter((d) =>
      NATIVE_BUILD_DEPS.includes(d)
    )
  } catch {
    // ignore — package.json unparseable, считаем что нативных нет
  }
  return {
    isNodeProject: true,
    node: { required, nativeDeps }
  }
}

/**
 * Сводка состояния toolchain'а на машине.
 * Кэшируется на 60 секунд.
 *
 * @typedef {Object} ToolchainState
 * @property {{ installed: boolean, version: string | null }} node
 * @property {{ installed: boolean, version: string | null, nodeVersions: string[] }} volta
 * @property {{ installed: boolean, version: string | null, path: string | null }} python
 * @property {{ installed: boolean, instances: any[] }} buildTools
 */

let cachedState = null
let cachedAt = 0
const CACHE_TTL_MS = 60 * 1000

export async function getToolchainState({ forceRefresh = false } = {}) {
  if (!forceRefresh && cachedState && Date.now() - cachedAt < CACHE_TTL_MS) {
    return cachedState
  }
  const [systemNode, volta, python, buildTools] = await Promise.all([
    getSystemNodeVersion(),
    getVoltaInfo(),
    getPythonInfo(),
    getBuildToolsInfo()
  ])
  cachedState = {
    node: { installed: !!systemNode, version: systemNode },
    volta,
    python,
    buildTools
  }
  cachedAt = Date.now()
  return cachedState
}

export function invalidateToolchainCache() {
  cachedState = null
  cachedAt = 0
}

/**
 * Что не хватает для setup'а данного проекта.
 *
 * @typedef {Object} MissingTools
 * @property {boolean} buildTools
 * @property {boolean} python
 * @property {string[]} reasons        человеческие сообщения зачем
 * @property {boolean} ok              true если ничего не блокирует
 */

/**
 * @param {ProjectRequirements} requirements
 * @param {ToolchainState} state
 * @returns {MissingTools}
 */
export function getMissingTools(requirements, state) {
  const reasons = []
  let needsBuildTools = false
  let needsPython = false

  if (
    requirements.isNodeProject &&
    requirements.node.nativeDeps.length > 0
  ) {
    if (!state.buildTools.installed) {
      needsBuildTools = true
      reasons.push(
        `Native build tools missing — required to compile ${requirements.node.nativeDeps
          .slice(0, 3)
          .join(', ')}${
          requirements.node.nativeDeps.length > 3 ? ', …' : ''
        }`
      )
    }
    if (!state.python.installed) {
      needsPython = true
      reasons.push(
        'Python missing — node-gyp uses Python for native build scripts'
      )
    }
  }

  return {
    buildTools: needsBuildTools,
    python: needsPython,
    reasons,
    ok: reasons.length === 0
  }
}
