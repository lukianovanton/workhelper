import en from './en.json'
import ru from './ru.json'
import { usePrefsStore } from '@/store/prefs.store.js'

/**
 * Простая i18n-инфраструктура. Без внешних библиотек: всё на
 * плоских JSON-словарях + хук, читающий текущий язык из prefs-store.
 *
 * Ключи плоские, в dot-notation: "settings.bitbucket.title".
 * Подстановка переменных: t("hello.user", { name: "Anton" })
 *   → "Hello, {name}" → "Hello, Anton".
 *
 * Если ключ отсутствует в текущем языке — фолбэк на en;
 * если и там нет — возвращаем сам ключ (хорошо видно в UI, что
 * перевод забыли).
 */

const DICTS = { en, ru }

export const SUPPORTED_LANGUAGES = /** @type {const} */ ([
  { id: 'en', label: 'English' },
  { id: 'ru', label: 'Русский' }
])

/**
 * Хук, возвращающий функцию перевода, зависящую от выбранного
 * языка. Subscribe'ится на изменения языка в prefs-store, поэтому
 * любой компонент перерисовывается при смене языка автоматически.
 *
 * @returns {(key: string, vars?: Object<string, string|number>) => string}
 */
export function useT() {
  const lang = usePrefsStore((s) => s.language) || 'en'
  const dict = DICTS[lang] || DICTS.en
  return (key, vars) => {
    const value =
      (dict[key] != null ? dict[key] : DICTS.en[key]) ?? key
    if (!vars || typeof value !== 'string') return value
    return value.replace(/\{(\w+)\}/g, (_, k) =>
      vars[k] != null ? String(vars[k]) : ''
    )
  }
}
