/**
 * Каталог категорий-бейджей для колонки Kind в списке проектов.
 *
 * Две категории — `project` и `template` — auto-assigned из VCS-данных
 * (provider.kind возвращает их). Остальные — user-overridable: юзер
 * кликает по бейджу в строке и выбирает свой ярлык (Personal, Work,
 * Important, Archived).
 *
 * Хранение пользовательских категорий: projectsMeta.categories[slug].
 * Если slug отсутствует — резолвится автоматически из project.kind.
 *
 * Добавление новой категории = одна запись здесь + (опционально) i18n
 * ключи. Не требует правок UI.
 *
 * @typedef {Object} ProjectCategory
 * @property {string} id
 * @property {string} labelKey                i18n-ключ
 * @property {React.ComponentType<{size?:number, className?:string}>} Icon
 * @property {string} pillClassName           tailwind-класс для pill'а
 *                                            (background + text + border)
 * @property {boolean} auto                   true если категория может
 *                                            быть auto-assigned из
 *                                            project.kind. Auto-категории
 *                                            попадают в picker'е первыми.
 * @property {boolean} [hideInPicker]         не показывать в picker'е
 *                                            (если категория устаревшая
 *                                            но ещё может встретиться в
 *                                            старых сохранённых данных).
 */

import { Package, FileCode2, User, Briefcase, Flame, Archive } from 'lucide-react'

/** @type {Record<string, ProjectCategory>} */
export const PROJECT_CATEGORIES = {
  project: {
    id: 'project',
    labelKey: 'projects.kind.project',
    Icon: Package,
    pillClassName: 'bg-sky-500/15 text-sky-400 border-sky-500/30',
    auto: true
  },
  template: {
    id: 'template',
    labelKey: 'projects.kind.template',
    Icon: FileCode2,
    pillClassName: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    auto: true
  },
  personal: {
    id: 'personal',
    labelKey: 'projects.kind.personal',
    Icon: User,
    pillClassName: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
    auto: false
  },
  work: {
    id: 'work',
    labelKey: 'projects.kind.work',
    Icon: Briefcase,
    pillClassName: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
    auto: false
  },
  important: {
    id: 'important',
    labelKey: 'projects.kind.important',
    Icon: Flame,
    pillClassName: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
    auto: false
  },
  archived: {
    id: 'archived',
    labelKey: 'projects.kind.archived',
    Icon: Archive,
    pillClassName: 'bg-muted/40 text-muted-foreground border-muted-foreground/30',
    auto: false
  }
}

/**
 * Резолв effective-категории. override (из projectsMeta) > auto-detect
 * из kind. Если override указывает на удалённую/несуществующую
 * категорию — fallback на auto-detect (graceful degradation).
 */
export function resolveProjectCategory(kind, override) {
  if (override && PROJECT_CATEGORIES[override]) {
    return PROJECT_CATEGORIES[override]
  }
  if (kind === 'template') return PROJECT_CATEGORIES.template
  return PROJECT_CATEGORIES.project
}

export function listProjectCategories() {
  return Object.values(PROJECT_CATEGORIES).filter((c) => !c.hideInPicker)
}

/**
 * Auto-резолв id'а из VCS-kind'а — нужен чтобы при сбросе override
 * к нему было что вернуться.
 */
export function autoCategoryIdForKind(kind) {
  return kind === 'template' ? 'template' : 'project'
}
