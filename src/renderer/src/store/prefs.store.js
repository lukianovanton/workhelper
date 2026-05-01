import { create } from 'zustand'

/**
 * UI-настройки приложения. Хранятся в localStorage, переживают
 * перезапуск. Это не «секретные» вещи и не «бизнес-конфиг» —
 * чистые предпочтения отображения. Поэтому отдельно от config-store
 * (который через electron-store + safeStorage).
 *
 * Поля:
 *   - theme:    'dark' | 'light' | 'system'
 *   - density:  'comfortable' | 'compact'
 *   - autoRefreshMs: 0 (off) | 60_000 | 300_000 | 600_000
 *   - searchHighlight: bool — подсвечивать совпадение в таблице
 *   - language: 'en' | 'ru' — UI-язык
 */

const KEY = 'workhelper-prefs'
const DEFAULTS = {
  theme: 'dark',
  density: 'comfortable',
  autoRefreshMs: 0,
  searchHighlight: true,
  language: 'en'
}

function load() {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULTS
    const parsed = JSON.parse(raw)
    return { ...DEFAULTS, ...parsed }
  } catch {
    return DEFAULTS
  }
}

function persist(state) {
  try {
    const slice = {
      theme: state.theme,
      density: state.density,
      autoRefreshMs: state.autoRefreshMs,
      searchHighlight: state.searchHighlight,
      language: state.language
    }
    localStorage.setItem(KEY, JSON.stringify(slice))
  } catch {
    // ignore
  }
}

export const usePrefsStore = create((set, get) => ({
  ...load(),

  setTheme: (theme) => {
    set({ theme })
    persist(get())
    applyTheme(theme)
  },
  setDensity: (density) => {
    set({ density })
    persist(get())
  },
  setAutoRefreshMs: (autoRefreshMs) => {
    set({ autoRefreshMs })
    persist(get())
  },
  setSearchHighlight: (searchHighlight) => {
    set({ searchHighlight })
    persist(get())
  },
  setLanguage: (language) => {
    set({ language })
    persist(get())
  }
}))

/**
 * Применяет тему: добавляет/убирает классы 'dark' и 'light' на
 * <html>. 'system' — следует за `prefers-color-scheme`.
 */
export function applyTheme(theme) {
  const html = document.documentElement
  let resolved = theme
  if (theme === 'system') {
    resolved = window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light'
  }
  html.classList.toggle('dark', resolved === 'dark')
  html.classList.toggle('light', resolved === 'light')
}

// Слушаем смену системной темы — если выбран 'system', реагируем live
if (typeof window !== 'undefined') {
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  mq.addEventListener?.('change', () => {
    const { theme } = usePrefsStore.getState()
    if (theme === 'system') applyTheme('system')
  })
}
