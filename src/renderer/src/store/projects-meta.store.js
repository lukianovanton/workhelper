import { create } from 'zustand'

/**
 * Per-project user metadata: избранные, заметки, recent, категории,
 * Jira-bindings.
 *
 * Persistence: main-процесс через api.meta.{get,set} (электрон-store
 * в userData/projects-meta.json). Раньше жили в localStorage, но он
 * scope'ится по origin URL'у — dev (Vite http://localhost) и prod
 * (file://) хранили данные раздельно. После переноса на main-store
 * оба режима читают один и тот же файл и видят одни и те же данные.
 *
 * Migration: на первом load() читаем legacy localStorage по ключу
 * `workhelper-projects-meta`. Если backend пуст — копируем как есть.
 * Если оба не пусты — мерджим (backend wins на конфликтах, legacy
 * заполняет пробелы). После миграции localStorage чистится.
 *
 * Shape:
 *   favorites:    { [slug]: true }
 *   recent:       [{ slug, ts }] (LRU last 20)
 *   notes:        { [slug]: string }
 *   categories:   { [slug]: categoryId }
 *   jiraBindings: { [jiraProjectKey]: slug }
 *   isLoaded:     boolean — true после первого успешного load()
 */

const LEGACY_KEY = 'workhelper-projects-meta'
const MAX_RECENT = 20
const DEFAULTS = {
  favorites: {},
  recent: [],
  notes: {},
  categories: {},
  jiraBindings: {}
}

function readLegacy() {
  try {
    const raw = localStorage.getItem(LEGACY_KEY)
    if (!raw) return null
    const p = JSON.parse(raw)
    return {
      favorites:
        p && typeof p.favorites === 'object' ? p.favorites : {},
      recent: Array.isArray(p?.recent) ? p.recent : [],
      notes: p && typeof p.notes === 'object' ? p.notes : {},
      categories:
        p && typeof p.categories === 'object' ? p.categories : {},
      jiraBindings:
        p && typeof p.jiraBindings === 'object' ? p.jiraBindings : {}
    }
  } catch {
    return null
  }
}

function clearLegacy() {
  try {
    localStorage.removeItem(LEGACY_KEY)
  } catch {
    // ignore
  }
}

function isStateEmpty(s) {
  if (!s) return true
  return (
    Object.keys(s.favorites || {}).length === 0 &&
    (s.recent || []).length === 0 &&
    Object.keys(s.notes || {}).length === 0 &&
    Object.keys(s.categories || {}).length === 0 &&
    Object.keys(s.jiraBindings || {}).length === 0
  )
}

/**
 * Merge: backend wins на конфликтах per-key, legacy fills gaps.
 * recent: чей массив длиннее (более активный) — тот и побеждает целиком,
 * чтобы не перемешивать timestamps.
 */
function mergeStates(backend, legacy) {
  return {
    favorites: { ...legacy.favorites, ...backend.favorites },
    recent:
      (backend.recent?.length || 0) >= (legacy.recent?.length || 0)
        ? backend.recent || []
        : legacy.recent || [],
    notes: { ...legacy.notes, ...backend.notes },
    categories: { ...legacy.categories, ...backend.categories },
    jiraBindings: { ...legacy.jiraBindings, ...backend.jiraBindings }
  }
}

function persist(state) {
  if (!window.api?.meta?.set) return
  window.api.meta
    .set({
      favorites: state.favorites,
      recent: state.recent,
      notes: state.notes,
      categories: state.categories,
      jiraBindings: state.jiraBindings
    })
    .catch((e) => {
      console.warn('[meta] persist failed:', e?.message || e)
    })
}

export const useProjectsMetaStore = create((set, get) => ({
  ...DEFAULTS,
  isLoaded: false,

  /**
   * One-shot load из main-store + миграция localStorage. Идемпотентен:
   * после первого успеха isLoaded=true и повторные вызовы no-op.
   */
  load: async () => {
    if (get().isLoaded) return
    let backend = null
    try {
      if (window.api?.meta?.get) {
        backend = await window.api.meta.get()
      }
    } catch (e) {
      console.warn('[meta] load failed:', e?.message || e)
    }
    backend = backend || { ...DEFAULTS }
    const legacy = readLegacy()

    let final
    if (legacy && isStateEmpty(backend)) {
      // Backend пустой, legacy есть — забираем legacy as-is, пишем
      // в backend, чистим localStorage.
      final = legacy
      persist(final)
      clearLegacy()
    } else if (legacy && !isStateEmpty(backend)) {
      // Оба не пусты — мердж (backend wins). Пишем результат в
      // backend, чистим localStorage.
      final = mergeStates(backend, legacy)
      persist(final)
      clearLegacy()
    } else {
      // Legacy нет (или пусто), используем backend как есть.
      if (legacy) clearLegacy()
      final = backend
    }
    set({ ...DEFAULTS, ...final, isLoaded: true })
  },

  toggleFavorite: (slug) => {
    set((s) => {
      const next = { ...s.favorites }
      if (next[slug]) delete next[slug]
      else next[slug] = true
      return { favorites: next }
    })
    persist(get())
  },

  isFavorite: (slug) => !!get().favorites[slug],

  /**
   * Записать факт «открыли drawer проекта». Дёргается из ProjectDetail
   * на mount. Хранит максимум MAX_RECENT, дедуплицирует по slug.
   */
  touchRecent: (slug) => {
    set((s) => {
      const filtered = s.recent.filter((r) => r.slug !== slug)
      const next = [{ slug, ts: Date.now() }, ...filtered].slice(0, MAX_RECENT)
      return { recent: next }
    })
    persist(get())
  },

  setNote: (slug, text) => {
    set((s) => {
      const next = { ...s.notes }
      if (text && text.trim()) next[slug] = text
      else delete next[slug]
      return { notes: next }
    })
    persist(get())
  },

  /**
   * Установить пользовательский category override для slug. null /
   * '' стирают override (back to auto-detect из project.kind).
   */
  setCategory: (slug, categoryId) => {
    set((s) => {
      const next = { ...s.categories }
      if (categoryId) next[slug] = categoryId
      else delete next[slug]
      return { categories: next }
    })
    persist(get())
  },

  /**
   * Привязать Jira-проект (по его key, например 'AQ') к WorkHelper-
   * slug'у. Перебивает auto-парсинг slug'а из имени Jira-проекта.
   * null / '' стирают binding (возврат к auto-парсу).
   *
   * Enforces 1:1 между slug'ом и Jira-проектом: при выставлении нового
   * binding'а удаляем любые другие ключи, ссылающиеся на этот же slug.
   */
  setJiraBinding: (jiraProjectKey, slug) => {
    if (!jiraProjectKey) return
    set((s) => {
      const next = { ...s.jiraBindings }
      if (slug) {
        const lower = slug.toLowerCase()
        for (const k of Object.keys(next)) {
          if (k !== jiraProjectKey && next[k]?.toLowerCase() === lower) {
            delete next[k]
          }
        }
        next[jiraProjectKey] = slug
      } else {
        delete next[jiraProjectKey]
      }
      return { jiraBindings: next }
    })
    persist(get())
  }
}))
