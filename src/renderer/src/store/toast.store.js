import { create } from 'zustand'

/**
 * Минимальный тостер. Тост — { id, kind, message, durationMs }.
 * Показывается в правом нижнем углу. Авто-исчезает по таймеру для
 * 'ok'/'info'; 'error' держится до явного закрытия (как в drawer-баннере).
 *
 * API:
 *   toast.ok(message), toast.info(message), toast.error(message)
 *   toast.dismiss(id)
 */

let nextId = 1

export const useToastStore = create((set, get) => ({
  toasts: [],

  push: (kind, message, opts = {}) => {
    const id = nextId++
    const durationMs =
      typeof opts.durationMs === 'number'
        ? opts.durationMs
        : kind === 'error'
          ? 0
          : 4000
    set((s) => ({
      toasts: [...s.toasts, { id, kind, message, durationMs }]
    }))
    if (durationMs > 0) {
      setTimeout(() => get().dismiss(id), durationMs)
    }
    return id
  },

  dismiss: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
}))

export const toast = {
  ok: (msg, opts) => useToastStore.getState().push('ok', msg, opts),
  info: (msg, opts) => useToastStore.getState().push('info', msg, opts),
  error: (msg, opts) => useToastStore.getState().push('error', msg, opts),
  dismiss: (id) => useToastStore.getState().dismiss(id)
}
