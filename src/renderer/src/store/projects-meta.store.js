import { create } from 'zustand'

/**
 * Per-project user metadata: избранные, заметки, последний-открытый,
 * пользовательская категория-бейдж. Не «server state» (это enrich
 * выдаёт) и не пользовательские «настройки» (это prefs.store) — а
 * пользовательские данные о конкретных проектах.
 *
 * Хранится в localStorage. Кросс-машинная синхронизация — out of scope
 * (если потребуется, можно через cloud-sync позже).
 *
 * Shape:
 *   favorites:    { [slug]: true } — set-style для O(1) проверки
 *   recent:       [{ slug, ts }] — LRU last 20
 *   notes:        { [slug]: string }
 *   categories:   { [slug]: categoryId } — пользовательский override
 *                 для бейджа в колонке Kind. Если slug отсутствует —
 *                 категория автодетектится из project.kind (project /
 *                 template). См. lib/project-categories.jsx.
 *   jiraBindings: { [jiraProjectKey]: slug } — явная привязка Jira-
 *                 проекта (например AQ) к WorkHelper-слагу. Перебивает
 *                 auto-парсинг slug'а из имени Jira-проекта. Нужно для
 *                 случаев, когда Jira project name не содержит slug
 *                 (короткий kодовый key типа AQ → repo aquisition-crm).
 */

const KEY = 'workhelper-projects-meta'
const MAX_RECENT = 20

const DEFAULTS = {
  favorites: {},
  recent: [],
  notes: {},
  categories: {},
  jiraBindings: {}
}

function load() {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULTS
    const parsed = JSON.parse(raw)
    return {
      favorites:
        parsed && typeof parsed.favorites === 'object'
          ? parsed.favorites
          : {},
      recent: Array.isArray(parsed?.recent) ? parsed.recent : [],
      notes:
        parsed && typeof parsed.notes === 'object' ? parsed.notes : {},
      categories:
        parsed && typeof parsed.categories === 'object'
          ? parsed.categories
          : {},
      jiraBindings:
        parsed && typeof parsed.jiraBindings === 'object'
          ? parsed.jiraBindings
          : {}
    }
  } catch {
    return DEFAULTS
  }
}

function persist(state) {
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        favorites: state.favorites,
        recent: state.recent,
        notes: state.notes,
        categories: state.categories,
        jiraBindings: state.jiraBindings
      })
    )
  } catch {
    // ignore
  }
}

export const useProjectsMetaStore = create((set, get) => ({
  ...load(),

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
   */
  setJiraBinding: (jiraProjectKey, slug) => {
    if (!jiraProjectKey) return
    set((s) => {
      const next = { ...s.jiraBindings }
      if (slug) next[jiraProjectKey] = slug
      else delete next[jiraProjectKey]
      return { jiraBindings: next }
    })
    persist(get())
  }
}))
