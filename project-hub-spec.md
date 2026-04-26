# Project Hub — спецификация

Десктоп-приложение для оркестрации 70+ репозиториев из Bitbucket Cloud с локальной MySQL и .NET-стеком. Цель — свести «склонировать → создать БД → восстановить дамп → открыть в VS Code → запустить» к одному клику.

---

## 1. Контекст и боль

- Bitbucket Cloud workspace `techgurusit`. Репо сгруппированы по Bitbucket-проектам с ключами вида `P0XXX` (production) и `TP0XXX` (templates). Slug репо разнообразный — большинство `pXXXX`, но встречаются `affiliatecrm`, `crmac`, `crm0042` и т.п. Не валидировать слаг по regex.
- Часть склонирована локально, часть нет
- Локальная MySQL на `localhost:3306`, БД именуются по слагу проекта в нижнем регистре (`p0026`, `p0070`, `affiliatecrm`)
- БД восстанавливаются из SQL-дампов (вручную через DBeaver)
- Каждый проект — `.NET` решение, запускается через `dotnet run`
- VS Code открывается через `.code-workspace`

**Текущий флоу для нового проекта (≈10 шагов, ~5 минут):** открыть Bitbucket → скопировать clone URL → консоль → `git clone` → DBeaver → создать БД → ПКМ → restore → выбрать дамп → VS Code → workspace → терминал → `git pull` → `dotnet run`.

**Целевой флоу:** клик «Setup & Run» → всё.

---

## 2. Технологический стек

| Слой | Технология |
|------|-----------|
| Shell | Electron 32+ |
| Сборка | electron-vite |
| Язык | JavaScript (ES2022+), JSDoc для документирования shape-ов |
| UI | React 18 (`.jsx`) |
| Стили | Tailwind v4 + shadcn/ui |
| State | Zustand (UI state) + TanStack Query (server state) |
| Routing | React Router |
| Bitbucket | axios + own client |
| Git | `simple-git` (fallback на git CLI через execa) |
| MySQL | `mysql2/promise` |
| Процессы | `execa` для разовых, `child_process.spawn` для long-running |
| Терминал | xterm.js + node-pty |
| Конфиг | `electron-store` |
| Секреты | Electron `safeStorage` API |
| Иконки | lucide-react |

**Почему не Tauri:** ядро приложения — это Node-операции (git, mysql, child_process), они в Node работают одной строкой. Rust добавил бы overhead без пользы для personal tool.

---

## 3. Архитектура

```
┌─────────────────────────────────────────────┐
│ Renderer (React)                            │
│  - Routes / Components / Hooks              │
│  - Zustand store                            │
│  - window.api.* (типизированный IPC)        │
└──────────────────┬──────────────────────────┘
                   │ contextBridge / IPC
┌──────────────────▼──────────────────────────┐
│ Main process                                │
│  ├─ services/                               │
│  │   ├─ bitbucket-client.ts                 │
│  │   ├─ git-service.ts                      │
│  │   ├─ db-service.ts                       │
│  │   ├─ fs-service.ts (поиск дампов)        │
│  │   ├─ process-manager.ts (dotnet)         │
│  │   ├─ config-store.ts                     │
│  │   └─ secrets.ts (safeStorage)            │
│  └─ ipc/ (тонкие хэндлеры, дергают service) │
└─────────────────────────────────────────────┘
```

Главный принцип: вся логика — в сервисах main-процесса, IPC только маршалит данные. Renderer ничего не знает про fs / git / mysql.

---

## 4. Структура папок

```
project-hub/
├─ package.json
├─ electron.vite.config.js
├─ jsconfig.json              # для intellisense в VS Code, не обязателен
├─ src/
│  ├─ main/
│  │  ├─ index.js
│  │  ├─ ipc/
│  │  │  ├─ bitbucket.ipc.js
│  │  │  ├─ git.ipc.js
│  │  │  ├─ db.ipc.js
│  │  │  ├─ process.ipc.js
│  │  │  ├─ fs.ipc.js
│  │  │  └─ config.ipc.js
│  │  └─ services/
│  │     ├─ bitbucket-client.js
│  │     ├─ git-service.js
│  │     ├─ db-service.js
│  │     ├─ fs-service.js
│  │     ├─ process-manager.js
│  │     ├─ config-store.js
│  │     └─ secrets.js
│  ├─ preload/
│  │  └─ index.js          # contextBridge.exposeInMainWorld('api', ...)
│  ├─ shared/
│  │  ├─ types.js          # JSDoc typedefs: Project, AppConfig, SetupStep
│  │  └─ ipc-channels.js   # экспортируемые константы каналов
│  └─ renderer/
│     ├─ index.html
│     └─ src/
│        ├─ main.jsx
│        ├─ App.jsx
│        ├─ routes/
│        │  ├─ projects-list.jsx
│        │  ├─ project-detail.jsx
│        │  └─ settings.jsx
│        ├─ components/
│        │  ├─ project-row.jsx
│        │  ├─ status-icons.jsx
│        │  ├─ setup-dialog.jsx
│        │  ├─ terminal-pane.jsx
│        │  └─ ui/        # shadcn
│        ├─ store/
│        │  └─ projects.store.js
│        ├─ api/
│        │  └─ index.js   # обёртки над window.api с JSDoc
│        └─ hooks/
│           ├─ use-projects.js
│           └─ use-project-actions.js
```

---

## 5. Модель данных

JSDoc-аннотации — для документации и автокомплита в VS Code, JS остаётся обычным.

```js
// src/shared/types.js

/**
 * @typedef {'project' | 'template'} ProjectKind
 *           Определяется по repo.project.key из Bitbucket API:
 *           startsWith('TP') → 'template', иначе 'project'.
 *           НЕ парсить из slug — слаги бывают произвольные (affiliatecrm).
 */

/**
 * @typedef {Object} BitbucketCommit
 * @property {string} message
 * @property {string} author
 * @property {string} date    ISO timestamp
 * @property {string} hash
 */

/**
 * @typedef {Object} BitbucketInfo
 * @property {string} url             https://bitbucket.org/techgurusit/p0070
 * @property {string} cloneUrl        HTTPS clone URL
 * @property {BitbucketCommit} [lastCommit]
 */

/**
 * @typedef {Object} LocalInfo
 * @property {string|null} path               projectsRoot/slug.toLowerCase()
 * @property {boolean} cloned
 * @property {boolean} dirty                  есть несохранённые изменения
 * @property {string|null} branch
 * @property {{ ahead: number, behind: number }} [aheadBehind]
 * @property {string|null} lastPullAt         ISO timestamp из state cache
 * @property {string|null} runnableSubpath    относит. путь к папке с Program.cs
 *                                            (см. 9.5). null если не определён.
 */

/**
 * @typedef {Object} DbInfo
 * @property {string} name                    slug.toLowerCase() — всегда
 * @property {boolean} exists
 * @property {number|null} sizeBytes
 * @property {string|null} dumpPath           путь к дампу если найден
 */

/**
 * @typedef {Object} RuntimeInfo
 * @property {boolean} running
 * @property {number|null} pid
 * @property {number|null} port
 * @property {string|null} startedAt
 */

/**
 * @typedef {Object} Project
 * @property {string} slug                   'p0070'
 * @property {string} name
 * @property {string} [description]
 * @property {ProjectKind} kind              'template' если slug начинается с 'tp'
 * @property {BitbucketInfo} bitbucket
 * @property {LocalInfo} local
 * @property {DbInfo} db
 * @property {RuntimeInfo} runtime
 */

/**
 * @typedef {Object} AppConfig
 * @property {{ workspace: string, username: string }} bitbucket
 *           appPassword хранится через safeStorage отдельно
 * @property {{
 *   projectsRoot: string,
 *   dumpsRoot: string,
 *   vscodeExecutable: string
 * }} paths
 *           projectsRoot default = 'C:\\Projects'
 *           vscodeExecutable default = 'code' (в PATH).
 *           В Settings показываем «detected: <abs>» справа от поля для информации.
 *           Поле workspaceFilePattern удалено: glob *.code-workspace выполняется
 *           per-проект (см. 9.5).
 * @property {{
 *   host: string,
 *   port: number,
 *   user: string,
 *   mysqlExecutable: string
 * }} database
 *           password — через safeStorage.
 *           mysqlExecutable — абсолютный путь к mysql CLI (или пусто).
 *           В MVP-1 не используется. В MVP-2 при пустом/невалидном — UI
 *           показывает подсказку «укажи путь в Settings», операция не падает.
 * @property {{
 *   runArgs: string[],
 *   workingDirSubpathOverride?: Object<string, string>
 * }} dotnet
 *           workingDirSubpath резолвится автоматически (см. 9.5).
 *           workingDirSubpathOverride — карта slug → подпуть на случай,
 *           когда автодетект не сработал; задаётся в Settings вручную.
 */
```

---

## 6. IPC контракт

`window.api.*` в renderer. Описано в JSDoc для автокомплита, реализуется обычным JS.

```js
// src/renderer/src/api/index.js (форма того, что получает renderer)

/**
 * @typedef {Object} BitbucketApi
 * @property {() => Promise<Project[]>} list           список с Bitbucket + локальный enrich
 * @property {() => Promise<Project[]>} refresh        force refresh
 * @property {() => Promise<boolean>} testConnection
 *
 * @typedef {Object} GitApi
 * @property {(slug: string) => Promise<void>} clone
 * @property {(slug: string) => Promise<{updated: boolean, summary: string}>} pull
 * @property {(slug: string) => Promise<{dirty: boolean, branch: string}>} status
 *
 * @typedef {Object} DbApi
 * @property {() => Promise<string[]>} list                            SHOW DATABASES
 * @property {(name: string) => Promise<void>} create
 * @property {(name: string) => Promise<void>} drop
 * @property {(name: string, dumpPath: string) => Promise<void>} restore
 * @property {(name: string) => Promise<boolean>} exists
 * @property {(name: string) => Promise<number>} size
 *
 * @typedef {Object} FsApi
 * @property {(slug: string) => Promise<string|null>} findDump
 * @property {() => Promise<string|null>} pickDump                     нативный диалог
 * @property {(slug: string) => Promise<boolean>} projectExists
 *
 * @typedef {Object} ProcessApi
 * @property {(slug: string) => Promise<{pid: number}>} run
 * @property {(slug: string) => Promise<void>} stop
 * @property {(slug: string) => Promise<boolean>} isRunning
 * @property {(slug: string, cb: (chunk: string) => void) => () => void} onLog   возвращает unsubscribe
 *
 * @typedef {Object} EditorApi
 * @property {(slug: string) => Promise<void>} openInVSCode
 *
 * @typedef {Object} ConfigApi
 * @property {() => Promise<AppConfig>} get
 * @property {(patch: Partial<AppConfig>) => Promise<void>} set
 * @property {(key: 'bitbucketAppPassword'|'dbPassword', value: string) => Promise<void>} setSecret
 *
 * @typedef {Object} SetupApi
 * @property {(slug: string) => Promise<void>} runFull                 clone + db + restore + workspace
 * @property {(slug: string, cb: (step: SetupStep) => void) => () => void} onProgress
 */

/**
 * SetupStep — discriminated по полю kind.
 *
 * @typedef {Object} SetupStep
 * @property {'clone'|'db-create'|'db-restore'|'workspace'} kind
 * @property {'start'|'progress'|'done'|'error'} status
 * @property {number} [percent]                 только для db-restore
 * @property {string} [message]
 */
```

В preload главное — типизация runtime, JSDoc просто помогает редактору не теряться:

```js
// src/preload/index.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  bitbucket: {
    list: () => ipcRenderer.invoke('bitbucket:list'),
    refresh: () => ipcRenderer.invoke('bitbucket:refresh'),
    testConnection: () => ipcRenderer.invoke('bitbucket:test'),
  },
  // ...остальные неймспейсы аналогично
});
```

---

## 7. Bitbucket API

Workspace: `techgurusit`. Auth: HTTP Basic с email + App Password (создаётся в `id.atlassian.com` → Bitbucket → App passwords с правами `Repositories: Read`).

Эндпоинты:
- Список репо: `GET https://api.bitbucket.org/2.0/repositories/{workspace}?pagelen=100&fields=values.slug,values.name,values.description,values.links,values.project,next` (пагинация по `next`)
- Последний коммит: `GET /repositories/{workspace}/{slug}/commits?pagelen=1`
- Clone URL: из `links.clone[]` — взять с `name === 'https'`

Кэш списка — в `electron-store` с TTL 10 минут, refresh по кнопке.

---

## 8. UI / экраны

### 8.1 Projects List (главный)

Layout: левый sidebar 240px + основной контент.

**Sidebar:**
- Кнопка ⟳ Refresh
- Фильтры (radio): All / Installed / Not installed / Templates / Running
- Поиск
- Внизу: ⚙ Settings

**Таблица проектов** (sticky header, виртуализация при >100 строк):

| Иконка-статус | Slug | Name | Last commit | Размер БД | Actions |

**Status icons** (компактно, 4 точки):
- 🟢/⚪ cloned
- 🟢/⚪ db exists
- 🟡 dirty (если cloned и есть uncommitted)
- 🔵 running

Клик по строке → открывает `project-detail` справа в drawer (50% ширины).

Hover на строку — quick actions: Pull, Run, Open in VS Code, Setup full (если не cloned).

### 8.2 Project Detail (drawer)

Шапка:
```
p0070  • techgurusit/p0070  [↗]
P0070 — описание из Bitbucket
[Setup & Run]  [Open in VS Code]  [Pull]  [Run]  [⋯]
```

Tabs:
- **Overview** — чеклист статусов:
  ```
  ✅ Cloned at C:\projects\p0070    Last pull: 2h ago
  ✅ DB p0070 exists (12.4 MB)
  🟢 Running on :5000               PID 14523    Started 3m ago
  ```
- **DB** — кнопка `Restore from dump`, селектор дампа (auto-detected или ручной), опция `Drop & re-create`
- **Git** — последние 10 коммитов с Bitbucket, статус локального бранча, кнопки Pull/Push
- **Terminal** — xterm в папке проекта
- **Logs** — stdout/stderr запущенного `dotnet run`

### 8.3 Setup Dialog (модал на «Setup & Run»)

Прогресс по шагам с галочками и ETA:
```
[✅] Clone repository                 done in 4s
[✅] Create database p0070            done
[🔄] Restore dump (45%)               12 MB / 27 MB
[⏳] Open VS Code workspace
[⏳] Run dotnet
```
По окончании — toast «Готово, p0070 запущен на :5000».

### 8.4 Settings

Секции:
- **Bitbucket** — workspace, email, app password (input type=password), кнопка Test connection
- **Paths** — `Projects folder` (default `C:\Projects`), `Dumps folder`, `VS Code path` (default `code`, под полем «detected: <abs>»). Паттерна workspace-файла больше нет — детекция per-проект (см. 9.5).
- **Database** — host, port, user, password, **mysql executable path** (пусто = «не настроено», нужно для MVP-2 restore), кнопка Test
- **.NET** — доп. аргументы `dotnet run`. `workingDirSubpath` детектится автоматически (см. 9.5). Override на проект — отдельным редактором карты в advanced-секции.

---

## 9. Бизнес-логика по операциям

### 9.1 Список проектов с enrich
```
1. bitbucket.list() → массив с Bitbucket (slug сохраняем как пришёл)
2. Для каждого вычисляем slugLower = slug.toLowerCase()
3. Для каждого:
   - kind = repo.project.key.startsWith('TP') ? 'template' : 'project'
   - local.path = path.join(projectsRoot, slugLower)
   - local.cloned = fs.existsSync(local.path)
   - local.branch / dirty = simple-git status (если cloned)
   - local.runnableSubpath = resolveRunnableSubpath(local.path) (см. 9.5)
   - db.name = slugLower (всегда нижний регистр)
   - db.exists = SHOW DATABASES → match по db.name
   - db.size = information_schema.tables sum data_length + index_length
   - db.dumpPath = fs-service.findDump(slugLower)
   - runtime.running = process-manager.isRunning(slug)
4. Возвращаем enriched
```

**Правило кейсов:** оригинальный `slug` (для отображения и обращений к Bitbucket
API) храним как пришёл; для пути на диске и имени БД — всегда `slug.toLowerCase()`.

### 9.2 Setup full (`setup.runFull`)
```
1. Если не cloned → git clone в projectsRoot/slug
2. Если БД нет → CREATE DATABASE `slug`
3. Если есть dumpPath:
   - mysql -u user -p slug < dumpPath  (через execa с прогрессом по байтам)
4. Если есть workspace-файл → открыть его в VS Code, иначе папку
5. Сообщить о завершении
```
Каждый шаг шлёт `SetupStep` через onProgress. Если шаг падает — следующие не запускаются, шаг помечается как error.

### 9.3 Run dotnet (`process.run`)
```
1. cwd = projectsRoot/slug + workingDirSubpath
2. spawn('dotnet', ['run', ...runArgs], { cwd })
3. Сохранить pid в process-manager (in-memory map slug→childProcess)
4. stdout/stderr через emitter в renderer
5. На exit — удалить из map, эмитнуть событие
```

### 9.4 Поиск дампа
```
fs-service.findDump(slugLower):
  candidates = [
    `{dumpsRoot}/{slugLower}.sql`,
    `{dumpsRoot}/{slugLower}.sql.gz`,
    `{dumpsRoot}/{slugLower.toUpperCase()}.sql`,
  ]
  return первый существующий или null
```
В Settings можно добавить дополнительные search roots.

### 9.5 Резолв runnable-проекта (workingDirSubpath) и VS Code workspace

**Runnable subpath** — относительный путь от корня репо до папки с `Program.cs`,
из которой запускается `dotnet run`. Резолвится один раз при enrich, кэшируется
в `local.runnableSubpath`.

```
resolveRunnableSubpath(repoRoot):
  1. override = config.dotnet.workingDirSubpathOverride[slugLower]
     если задан и {repoRoot}/{override}/Program.cs существует → return override
  2. slnPath = glob '{repoRoot}/*.sln' (берём первый)
     brand = basename(slnPath, '.sln')                   // P0070, AffiliateCRM
     если {repoRoot}/{brand}/Program.cs существует → return brand
  3. fallback: для каждого *.csproj в repoRoot/**:
        если рядом лежит Program.cs → return dirname относительно repoRoot
     первый match → return
  4. иначе → return null

  ⚠️ Не считать BusinessLogic/DataAccess/Utils runnable: у них нет Program.cs
     — это библиотечные .csproj в составе solution.
```

UI: если `runnableSubpath === null` — кнопка Run заблокирована, в Detail
показываем `⚠️ Cannot detect runnable project, set workingDirSubpath in Settings`.

**VS Code open** (`editor.openInVSCode`):
```
1. files = glob '{repoRoot}/*.code-workspace'
2. если files.length > 0 → spawn(vscodeExecutable, [files[0]])
3. иначе → spawn(vscodeExecutable, [repoRoot])
```
Когда workspace-файлы появятся в репо — поведение само переключится.

---

## 10. MVP-разбивка для Claude Code

### MVP-1 — «читалка», без destructive операций
Цель: видеть всё, но не менять.

1. Скелет Electron + React + Vite + Tailwind + shadcn
2. Settings: Bitbucket creds + paths + DB creds, тест connection
3. Bitbucket client + список репо с пагинацией
4. Главный экран — таблица проектов из Bitbucket
5. Enrich статусом `cloned` (просто `fs.existsSync`)
6. Enrich статусом `db.exists` (через mysql2)
7. Detail panel — Overview tab
8. Кнопки только для cloned проектов: Pull, Run, Open in VS Code

**Точка отсечения MVP-1:** можно перестать ходить в Bitbucket за списком и в DBeaver за статусом БД.

### MVP-2 — «одна кнопка»
9. `git clone` через simple-git
10. `CREATE DATABASE`, `DROP DATABASE`
11. Restore из дампа (mysql CLI через execa, прогресс)
12. Setup dialog с прогрессом по шагам
13. process-manager + Run/Stop с логами

**Точка отсечения MVP-2:** новый проект ставится одним кликом.

### MVP-3 — комфорт
14. Встроенный xterm в Terminal tab
15. Git tab с историей коммитов
16. Hotkeys (Ctrl+K палитра команд, Ctrl+R run)
17. Уведомления через `Notification` API
18. Группировка projects vs templates
19. Dirty detection и предупреждения перед `Setup full` если уже cloned

---

## 11. Допущения (проверить на старте)

- ОС: Windows 11 (target — единственная dev-машина пользователя; cross-platform не цель)
- MySQL 8 на `localhost:3306`. **`mysql` CLI на dev-машине НЕ в PATH** — путь к нему задаётся в Settings → Database → mysql executable. Используется только в MVP-2 (restore дампов). MVP-1 ходит в БД через `mysql2/promise`.
- `git`, `dotnet`, `code` доступны в PATH (проверено: git 2.53, dotnet 9.0.311, VS Code установлен)
- Bitbucket Cloud workspace `techgurusit`, доступ через App Password
- Дампы — формат `.sql` (plain SQL), нейминг = `slug.toLowerCase()` проекта. `dumpsRoot` задаётся в Settings (дефолта нет).
- Один MySQL инстанс, одна папка проектов (`C:\Projects` по умолчанию), одна папка дампов

Если что-то из этого не так — сначала правим Settings и model, потом код.

---

## 12. Что попросить Claude Code в первой итерации

> Создай Electron + React проект **на чистом JavaScript** (без TypeScript) на electron-vite. Установи Tailwind v4 и инициализируй shadcn/ui (используй `.jsx` варианты компонентов). Настрой структуру папок согласно разделу 4 спеки. Для документирования shape-ов используй JSDoc как показано в разделе 5–6, не добавляй tsconfig и не пиши `.ts/.tsx` файлы. Реализуй MVP-1 целиком: Settings экран с сохранением через electron-store + safeStorage для секретов, Bitbucket client с авторизацией App Password и пагинацией, главный экран с таблицей проектов и фильтрами, enrich статусом cloned/db-exists, Detail drawer с Overview tab, и три кнопки на cloned проектах: Pull (simple-git), Run (spawn dotnet), Open in VS Code (execa `code` с workspace файлом). Никаких destructive операций пока — только чтение и safe-команды.

---

## 13. Дальше

После MVP-3 заводятся под спрос:
- Несколько одновременно запущенных проектов с автоприсвоением портов
- Просмотр и применение миграций
- Bitbucket PR list / approve
- Запуск тестов
- Шаблоны: «создать новый проект из TP0001»
- Команды-сценарии (макросы) — например, «обновить и протестировать N проектов»
