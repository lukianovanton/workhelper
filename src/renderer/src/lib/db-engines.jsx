/**
 * Renderer-side реестр DB-engine'ов. UI-метаданные (иконка/цвет
 * бейджа, форма DatabaseCard, executable detection, setup-гайд).
 *
 * Backend имеет свой реестр в src/main/services/db/engines.js
 * (фабрики, defaults, normalizeDbName).
 *
 * Добавление нового движка (MSSQL, MongoDB):
 *   1. createXEngine + регистрация в backend engines.js
 *   2. Descriptor сюда
 *   3. DatabaseCard / Add-buttons / Defaults / SETUP_GUIDES — автоматом
 */

import { Database } from 'lucide-react'
import { DatabaseSetupGuide } from '@/components/setup-guides/database'
import { PostgresSetupGuide } from '@/components/setup-guides/postgres'

/**
 * @typedef {Object} DbEngineForm
 * @property {string} hostPlaceholder
 * @property {string} portPlaceholder
 * @property {string} userPlaceholder
 * @property {string} executableLabelKey
 * @property {string} executableNotFoundKey
 * @property {string} executableOptionalKey
 * @property {string} executablePathPlaceholder    подсказка в input'е
 *
 * @typedef {Object} DbEngineDescriptor
 * @property {string} type
 * @property {string} label                    UI dropdown / subtitle
 * @property {string} fallbackName             default name если host пуст
 * @property {number} defaultPort              для инициализации draft'а
 * @property {string} defaultUser              для инициализации draft'а
 * @property {React.ComponentType<{size?:number, className?:string}>} Icon
 * @property {string} iconClassName
 * @property {string} addButtonLabelKey
 * @property {string} newDatabaseTitleKey      i18n-ключ заголовка карточки
 *                                              в режиме "новый draft"
 * @property {string} executableName           ключ для api.config.whichBinary
 *                                              (синхронен с backend
 *                                              def.executableName)
 * @property {React.ComponentType} GuideComponent
 * @property {string} guideTitleKey
 * @property {string} guideDescriptionKey
 * @property {DbEngineForm} form
 */

/** @type {Record<string, DbEngineDescriptor>} */
export const DB_ENGINES = {
  mysql: {
    type: 'mysql',
    label: 'MySQL',
    fallbackName: 'MySQL',
    defaultPort: 3306,
    defaultUser: 'root',
    Icon: Database,
    iconClassName: 'text-amber-500/80',
    addButtonLabelKey: 'settings.databases.add.mysql',
    newDatabaseTitleKey: 'settings.databases.newDatabase.mysql',
    executableName: 'mysql',
    GuideComponent: DatabaseSetupGuide,
    guideTitleKey: 'settings.database.title',
    guideDescriptionKey: 'settings.guide.database.dialogDescription',
    form: {
      hostPlaceholder: 'localhost',
      portPlaceholder: '3306',
      userPlaceholder: 'root',
      executableLabelKey: 'settings.database.mysqlExecutable',
      executableNotFoundKey: 'settings.database.mysqlExecutable.notFound',
      executableOptionalKey: 'settings.database.mysqlExecutable.optional',
      executablePathPlaceholder: 'C:\\path\\to\\mysql.exe'
    }
  },
  postgres: {
    type: 'postgres',
    label: 'PostgreSQL',
    fallbackName: 'PostgreSQL',
    defaultPort: 5432,
    defaultUser: 'postgres',
    Icon: Database,
    iconClassName: 'text-sky-500/80',
    addButtonLabelKey: 'settings.databases.add.postgres',
    newDatabaseTitleKey: 'settings.databases.newDatabase.postgres',
    executableName: 'psql',
    GuideComponent: PostgresSetupGuide,
    guideTitleKey: 'settings.postgres.guide.title',
    guideDescriptionKey: 'settings.guide.postgres.dialogDescription',
    form: {
      hostPlaceholder: 'localhost',
      portPlaceholder: '5432',
      userPlaceholder: 'postgres',
      executableLabelKey: 'settings.database.psqlExecutable',
      executableNotFoundKey: 'settings.database.psqlExecutable.notFound',
      executableOptionalKey: 'settings.database.psqlExecutable.optional',
      executablePathPlaceholder: 'C:\\path\\to\\psql.exe'
    }
  }
}

export function getDbEngine(type) {
  return DB_ENGINES[type] || null
}

export function listDbEngines() {
  return Object.values(DB_ENGINES)
}
