import { create } from 'zustand'

/**
 * Состояние активной Setup-операции.
 *
 * Setup-диалог modal'ный и не переживает закрытия. Но операция в main
 * продолжается. Чтобы корректно перерисовать диалог при reopen — храним
 * прогресс здесь, обновляется глобальным подписчиком в App.jsx.
 *
 * @typedef {{
 *   phase: 'running'|'finished'|'failed'|'cancelled',
 *   steps: Record<string, {
 *     status: 'start'|'progress'|'done'|'error',
 *     percent?: number,
 *     bytesRead?: number,
 *     totalBytes?: number,
 *     durationMs?: number,
 *     message?: string
 *   }>,
 *   error?: string
 * }} SetupState
 */

export const useSetupStore = create((set) => ({
  /** @type {Record<string, SetupState>} */
  bySlug: {},

  start: (slug) =>
    set((s) => ({
      bySlug: {
        ...s.bySlug,
        [slug]: { phase: 'running', steps: {} }
      }
    })),

  applyStep: (slug, step) =>
    set((s) => {
      const prev = s.bySlug[slug]
      if (!prev) return {}
      return {
        bySlug: {
          ...s.bySlug,
          [slug]: {
            ...prev,
            steps: {
              ...prev.steps,
              [step.kind]: {
                status: step.status,
                percent: step.percent,
                bytesRead: step.bytesRead,
                totalBytes: step.totalBytes,
                durationMs: step.durationMs,
                message: step.message
              }
            }
          }
        }
      }
    }),

  finished: (slug) =>
    set((s) => {
      const prev = s.bySlug[slug]
      if (!prev) return {}
      return {
        bySlug: { ...s.bySlug, [slug]: { ...prev, phase: 'finished' } }
      }
    }),

  failed: (slug, message) =>
    set((s) => {
      const prev = s.bySlug[slug]
      if (!prev) return {}
      return {
        bySlug: {
          ...s.bySlug,
          [slug]: { ...prev, phase: 'failed', error: message }
        }
      }
    }),

  cancelled: (slug) =>
    set((s) => {
      const prev = s.bySlug[slug]
      if (!prev) return {}
      return {
        bySlug: { ...s.bySlug, [slug]: { ...prev, phase: 'cancelled' } }
      }
    }),

  clear: (slug) =>
    set((s) => {
      const next = { ...s.bySlug }
      delete next[slug]
      return { bySlug: next }
    })
}))
