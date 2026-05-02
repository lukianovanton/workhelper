/**
 * Per-project user metadata в main-процессе через electron-store.
 *
 * Раньше эти данные жили в renderer'овском localStorage (через
 * zustand-store), но Chromium scope'ит localStorage по origin URL'у:
 *   dev    → http://localhost:5173/  (Vite dev-server)
 *   prod   → file://                 (упакованный html)
 *
 * Разные origin'ы → разные localStorage-каталоги, даже если userData
 * один и тот же. Из-за этого пользовательские категории / jira-binding'и
 * не синхронизировались между npm run dev и упакованным exe (хотя
 * config.json через electron-store работал нормально, потому что main
 * пишет в userData/config.json безусловно).
 *
 * Решение: positionate те же поля, что были в zustand-store, но
 * хранение через electron-store в файле userData/projects-meta.json.
 * Renderer-store (см. src/renderer/src/store/projects-meta.store.js)
 * через IPC читает / пишет; на старте делает one-shot миграцию из
 * legacy localStorage.
 *
 * Shape ровно повторяет рендеровский:
 *   favorites:    { [slug]: true }
 *   recent:       [{ slug, ts }]
 *   notes:        { [slug]: string }
 *   categories:   { [slug]: categoryId }
 *   jiraBindings: { [jiraProjectKey]: slug }
 */

import Store from 'electron-store'

const store = new Store({
  name: 'projects-meta',
  clearInvalidConfig: true,
  defaults: {
    favorites: {},
    recent: [],
    notes: {},
    categories: {},
    jiraBindings: {}
  }
})

export function getMeta() {
  return {
    favorites: store.get('favorites') || {},
    recent: store.get('recent') || [],
    notes: store.get('notes') || {},
    categories: store.get('categories') || {},
    jiraBindings: store.get('jiraBindings') || {}
  }
}

/**
 * Patch-update: каждое поле в patch'е — full-replace, не merge.
 * Renderer-store при любом изменении (toggle favorite / setCategory /
 * etc) шлёт целое состояние, чтобы было однозначно. deepMerge'а не
 * нужно — стороны управления одна (renderer есть source of truth).
 */
export function setMeta(patch) {
  if (!patch || typeof patch !== 'object') return
  if (Object.prototype.hasOwnProperty.call(patch, 'favorites')) {
    store.set('favorites', patch.favorites || {})
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'recent')) {
    store.set('recent', Array.isArray(patch.recent) ? patch.recent : [])
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'notes')) {
    store.set('notes', patch.notes || {})
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'categories')) {
    store.set('categories', patch.categories || {})
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'jiraBindings')) {
    store.set('jiraBindings', patch.jiraBindings || {})
  }
}
