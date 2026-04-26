import { create } from 'zustand'

/**
 * Состояние активных restore-операций.
 *
 * Хранится в zustand на уровне приложения (не в drawer'е), чтобы
 * прогресс переживал mount/unmount Detail drawer'а — пользователь
 * может закрыть drawer на 5 минут и при возврате увидеть тот же
 * progress bar.
 *
 * Источник правды: main-процесс. App.jsx подписывается на
 * db:restore-event при старте и пишет в этот стор.
 *
 * @typedef {{
 *   bytesRead: number,
 *   totalBytes: number,
 *   startedAt: number,
 *   status: 'running'|'done'|'error',
 *   message?: string,
 *   dumpFile?: string
 * }} RestoreState
 */

export const useRestoreStore = create((set) => ({
  /** @type {Record<string, RestoreState>} */
  bySlug: {},

  start: (slug, totalBytes) =>
    set((s) => ({
      bySlug: {
        ...s.bySlug,
        [slug]: {
          bytesRead: 0,
          totalBytes,
          startedAt: Date.now(),
          status: 'running'
        }
      }
    })),

  setProgress: (slug, bytesRead, totalBytes) =>
    set((s) => {
      const prev = s.bySlug[slug]
      return {
        bySlug: {
          ...s.bySlug,
          [slug]: {
            bytesRead,
            totalBytes,
            startedAt: prev?.startedAt || Date.now(),
            status: 'running'
          }
        }
      }
    }),

  done: (slug, payload) =>
    set((s) => {
      const prev = s.bySlug[slug]
      if (!prev) return {}
      return {
        bySlug: {
          ...s.bySlug,
          [slug]: {
            ...prev,
            ...payload,
            status: 'done'
          }
        }
      }
    }),

  error: (slug, message) =>
    set((s) => {
      const prev = s.bySlug[slug]
      if (!prev) {
        return {
          bySlug: {
            ...s.bySlug,
            [slug]: {
              bytesRead: 0,
              totalBytes: 0,
              startedAt: Date.now(),
              status: 'error',
              message
            }
          }
        }
      }
      return {
        bySlug: {
          ...s.bySlug,
          [slug]: { ...prev, status: 'error', message }
        }
      }
    }),

  clear: (slug) =>
    set((s) => {
      const next = { ...s.bySlug }
      delete next[slug]
      return { bySlug: next }
    })
}))
