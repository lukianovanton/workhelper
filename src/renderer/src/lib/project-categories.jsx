/**
 * Каталог категорий-бейджей для колонки Kind в списке проектов.
 *
 * Две категории — `project` и `template` — auto-assigned из VCS-данных
 * (provider.kind возвращает их). Остальные — user-overridable: юзер
 * кликает по бейджу в строке и выбирает свой ярлык (Personal, Work,
 * Important, Archived, External).
 *
 * Хранение пользовательских категорий: projectsMeta.categories[slug].
 * Если slug отсутствует — резолвится автоматически из project.kind.
 *
 * `order`-поле задаёт sort-priority в списке проектов: меньше — выше.
 * Список рендерится отсортированным по category.order: Important сверху,
 * External самый низ. Внутри одной категории остаётся текущий sort
 * (favorites / tasks / column).
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
 * @property {number} order                   sort-priority. 0 = top.
 * @property {boolean} [hideInPicker]         не показывать в picker'е.
 */

import {
  Package,
  FileCode2,
  User,
  Briefcase,
  Flame,
  Archive,
  UserX,
  Pause,
  Globe
} from 'lucide-react'

/** @type {Record<string, ProjectCategory>} */
export const PROJECT_CATEGORIES = {
  important: {
    id: 'important',
    labelKey: 'projects.kind.important',
    Icon: Flame,
    pillClassName: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
    auto: false,
    order: 0
  },
  personal: {
    id: 'personal',
    labelKey: 'projects.kind.personal',
    Icon: User,
    pillClassName: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
    auto: false,
    order: 1
  },
  work: {
    id: 'work',
    labelKey: 'projects.kind.work',
    Icon: Briefcase,
    pillClassName: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
    auto: false,
    order: 2
  },
  project: {
    id: 'project',
    labelKey: 'projects.kind.project',
    Icon: Package,
    pillClassName: 'bg-sky-500/15 text-sky-400 border-sky-500/30',
    auto: true,
    order: 3
  },
  template: {
    id: 'template',
    labelKey: 'projects.kind.template',
    Icon: FileCode2,
    pillClassName: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    auto: true,
    order: 4
  },
  // Landing — отдельный слой под template'ами. Marketing-страницы,
  // promo-сайты, кампания-specific одностраничники. Часто active-work
  // (поэтому выше On Hold), но семантически отделены от обычных
  // Project / Template. Globe-иконка — «web presence».
  landing: {
    id: 'landing',
    labelKey: 'projects.kind.landing',
    Icon: Globe,
    pillClassName: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    auto: false,
    order: 5
  },
  // On Hold / «На паузе» — для проектов, которые иногда используются
  // но не активно: pet-tools которые трогаешь раз в квартал, временно
  // отложенные репозитории, etc. Между Landing и Archived.
  // Stone-цвет — нейтральный warm-gray, не attention-grabbing как
  // Template (amber) и не такой «мёртвый» как Archived.
  onhold: {
    id: 'onhold',
    labelKey: 'projects.kind.onhold',
    Icon: Pause,
    pillClassName: 'bg-stone-500/15 text-stone-400 border-stone-500/30',
    auto: false,
    order: 6
  },
  archived: {
    id: 'archived',
    labelKey: 'projects.kind.archived',
    Icon: Archive,
    pillClassName:
      'bg-muted/40 text-muted-foreground border-muted-foreground/30',
    auto: false,
    order: 7
  },
  external: {
    id: 'external',
    labelKey: 'projects.kind.external',
    Icon: UserX,
    pillClassName:
      'bg-slate-500/15 text-slate-400 border-slate-500/30',
    auto: false,
    order: 8
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
  return Object.values(PROJECT_CATEGORIES)
    .filter((c) => !c.hideInPicker)
    .sort((a, b) => a.order - b.order)
}

/**
 * Auto-резолв id'а из VCS-kind'а — нужен чтобы при сбросе override
 * к нему было что вернуться.
 */
export function autoCategoryIdForKind(kind) {
  return kind === 'template' ? 'template' : 'project'
}
