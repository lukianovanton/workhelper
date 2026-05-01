# WorkHelper

Desktop-приложение для повседневной работы с Bitbucket-репозиториями
и связанными Jira-задачами. Один клик — клонирование, БД, восстановление
дампа, запуск .NET-проекта; рядом — pipelines, коммиты с diff, My Tasks
и комментарии к Jira прямо из приложения.

## Установка

1. Скачай `WorkHelper Setup X.X.X.exe` со страницы
   [Releases](https://github.com/lukianovanton/workhelper/releases/latest)
2. Запусти установщик
3. Запусти приложение через ярлык на рабочем столе
4. Авто-обновления приходят сами и применяются при следующем запуске

### Системные требования

- Windows 10/11 x64
- `git`, `.NET SDK 9+`, локальный MySQL 8
- Желательно VS Code в PATH

## Первая настройка

Settings (⚙ слева внизу). Шесть секций; для каждой есть кнопка **Setup
guide** в шапке карточки с пошаговой инструкцией и прямыми ссылками
на нужные страницы.

### Atlassian (Bitbucket + Jira)

Один Atlassian-аккаунт, два API-токена. Email общий — задаётся один
раз в Bitbucket-карточке и переиспользуется для Jira.

#### Bitbucket токен

`id.atlassian.com → Security → API tokens → Create API token with scopes`.
Выбери API: **Bitbucket**. Scopes:

- Read: `read:account`, `read:workspace:bitbucket`, `read:repository:bitbucket`,
  `read:pullrequest:bitbucket`, `read:pipeline:bitbucket`
- Write: `write:repository:bitbucket`, `write:pullrequest:bitbucket`

Поля в Settings → Atlassian:

- **Email** — твой Atlassian-email
- **Workspace** — короткий ID из URL (`bitbucket.org/<workspace>/...`)
- **Bitbucket username** — НЕ email; видно на bitbucket.org/account/settings.
  Используется в URL `git clone`
- **API token** — классический токен из шага выше

`Test connection` → должно сказать "Authenticated as &lt;твоё имя&gt;".

#### Jira токен

Отдельный токен (Atlassian не даёт один токен на оба продукта). Здесь
нужен **классический** — кнопка `Create API token` (не "with scopes")
на той же странице.

Поля в той же секции Atlassian → Jira:

- **Host** — URL твоего Jira (`https://<company>.atlassian.net`)
- **API token** — Jira-токен

> **Для Jira не используй "Create API token with scopes"** — у scoped-токенов
> есть известный баг Atlassian: JQL `currentUser()` не резолвится через
> Bearer-auth, и My Tasks показывает пустоту. Классические токены работают
> через Basic auth и резолвят `currentUser()` корректно. Для Bitbucket,
> наоборот, рекомендуется scoped — см. секцию выше.

### Paths

- **Projects folder** — куда клонируются репо (`C:\Projects` по умолчанию).
  Каждое репо клонируется в `<root>/<slug>`.
- **Dumps folder** — где лежат SQL-дампы (для авто-restore)
- **VS Code executable** — обычно `code` в PATH; для абсолютного пути
  жми "Use detected"

### Database

- **Host** / **Port** / **User** — стандартные для MySQL
- **Password** — твой MySQL-пароль (хранится зашифрованно через
  Electron safeStorage / DPAPI)
- **mysql executable** — путь к `mysql.exe` (опциональный, нужен только
  для restore из дампов)

### .NET

- **Run arguments** — опциональные аргументы для `dotnet run`. Большинству
  оставлять пустым.

### Presence

Включает UDP-broadcast присутствия в локальной сети / Tailnet. Виден
число коллег онлайн в шапке списка проектов. По умолчанию выключено;
broadcast'ит только hostname / username / local IP / версию приложения.

### Appearance

- **Language** — английский / русский, переключается на лету
- **Theme** — тёмная / светлая / системная
- **Density** — Comfortable (по умолчанию) / Compact
- **Auto-refresh projects** — как часто фоном обновлять список из Bitbucket
- **Highlight search matches** — подсветка в поиске

## Использование

### Главный экран — Projects

Список 100+ репозиториев из Bitbucket workspace. Слева sidebar с
фильтрами (Status / Type), главный экран — таблица с колонками:

- **точки слева** — состояние (склонирован / БД / running)
- **slug** — id репо. Если на проекте есть твои открытые Jira-таски,
  справа от slug появляется бейдж 📋 N
- **Name** + описание
- **Kind** — Project / Template (по prefix Jira-проекта)
- **DB size** — размер локальной БД
- **Last commit** — относительная дата + точка цвета последнего pipeline'а
  (грузится лениво при hover на строку или сразу для starred)

**Сортировка приоритетов**:

1. ⭐ Starred всегда сверху
2. Проекты с твоими Jira-тасками (больше тасков → выше)
3. Остальные по выбранной колонке

Клик по строке → открывается drawer справа.

### Drawer проекта

Шапка с действиями (зависят от состояния):
- Не склонирован → **Setup & Run** (orchestrator) или **Clone only**
- Склонирован → **Open in VS Code**, **Open folder**, **Pull**, **Run / Stop**,
  **Setup remaining**

Под action-баром четыре таба:

#### Overview

- Чек-лист состояния (cloned / DB / running)
- Branch switcher (для склонированных)
- DB section с restore / drop / create
- **Recent commits** — последние 5 коммитов в виде аккордеона; клик
  раскрывает ту же детализацию что и в Commits-табе (полный diffstat,
  файлы с inline diff, "Open on Bitbucket")
- Notes (локальные заметки на этой машине)

#### Commits

30 последних коммитов с branch picker'ом. Клик по строке → раскрывается
inline-detail:
- Полный текст commit message (если есть body)
- Diffstat: список файлов с +/- и иконкой статуса (A/M/D/R)
- Клик по файлу → подгружается **unified diff** этого файла из
  Bitbucket с подсветкой по +/- /@@
- Ссылка "Open on Bitbucket"

#### Pipelines

20 последних пайплайнов. Бейдж статуса (✓ Successful / ✗ Failed /
⏵ In progress / ⏸ Paused / etc.) + branch + duration + author.

Клик → детали пайплайна со списком steps. Клик по завершённому step'у
→ inline-просмотр **полного step-лога** из Bitbucket в тёмной pre-плашке.

Если в выдаче есть IN_PROGRESS / PENDING — список авто-обновляется
каждые 15 секунд (видно через спиннер на refresh-иконке).

#### Tasks

Открытые Jira-задачи в проекте, который соответствует Bitbucket-slug'у
по префиксу имени (например slug `p0066` → Jira проект "p0066- Zeiad
Jewellery (Amjad)").

Три группы:
- **Assigned to you** — твои таски в этом проекте (sky-цвет, наверху)
- **Other open tasks** — остальные открытые
- **Recently done** — последние 10 закрытых, свёрнутый аккордеон

В строке: тип, key, summary, assignee-аватар, due date (амбер если
просрочен), статус-бейдж, относительная дата.

Раскрытие — полная детализация задачи: chips статуса/типа/приоритета,
project link, assignee/reporter с аватарами, даты, labels, description
(с поддержкой ADF: ссылки, списки, smart-cards, mention'ы), последние
5 комментариев. **In-app actions**:
- **StatusPicker** — клик по статус-бейджу → выпадает список доступных
  transitions, выбор применяет
- **AssigneePicker** — клик по строке assignee → search-as-you-type
  по assignable юзерам, плюс кнопка "Unassign"
- **CommentForm** — textarea внизу комментариев, Ctrl/Cmd+Enter — отправить

Если в названии таска упоминается slug, отличный от того в котором
живёт задача (то есть таск создан в "не том" проекте), на строке
появляется амбер бейдж **mismatch** с tooltip какой именно slug упомянут.

### My Tasks (sidebar → My Tasks)

Все твои открытые Jira-задачи через все доступные проекты. JQL
работает по `assignee = currentUser()`; при невозможности резолва
currentUser() (на scoped-токенах) фолбэчится на explicit accountId
из `https://api.atlassian.com/me`.

- Группировка по statusCategory (To Do / In Progress / Done)
- Поиск по тексту (key, summary, project)
- Клик по строке → drawer справа с полной детализацией (тот же
  TaskDetailContent что и в проектном Tasks-табе, со всеми in-app
  actions)
- В detail-drawer'е строка `in P0066 — ...` кликабельная если у этого
  Jira-проекта есть Bitbucket-репо с матчинг slug'ом — переходит в
  drawer Bitbucket-проекта с автоматически открытой Tasks-вкладкой и
  развёрнутой текущей задачей

### Один клик: Setup & Run

Для не-склонированного проекта drawer показывает **Setup & Run**.
Открывается диалог с pre-flight (что будет сделано):

- clone из Bitbucket
- create database с именем slug
- restore из дампа (auto-detect в Dumps folder)
- open in VS Code
- start dotnet (по галочке)

Жмёшь Start → видишь прогресс по шагам → проект запущен.

### Дампы БД

Автодетект ищет в Dumps folder файлы по имени:

- `{slug}*` (например `p0070.sql`)
- `dump-{slug}*` (например `dump-P0070-2026-04-01`)

Регистр не важен. Берётся самый свежий по mtime. Поддерживается
plain SQL и gzip-сжатый дамп (определяется по содержимому).

## Troubleshooting

### Clone fails: authentication

Один раз клонируй вручную, чтобы Windows Credential Manager закэшировал:

```
git clone https://{your-username}@bitbucket.org/{workspace}/{slug}.git
```

Дальше приложение будет работать.

### My Tasks показывает пустоту, хотя на тебя есть задачи

Скорее всего у тебя **scoped Jira-токен** (создан через "Create API
token with scopes"). У них баг с `currentUser()` под Bearer-auth.
Создай **классический токен** (на той же странице, кнопка над scoped),
вставь в Settings, Save → Test → My Tasks.

### "Authentication failed (401)" / "scope insufficient"

- Скопировал ли токен с лишним пробелом?
- Email точно тот же что у Atlassian-аккаунта который создал токен?
- Если scoped-токен на Bitbucket: проверь, что выбраны все нужные scopes —
  `read:account`, `read:workspace:bitbucket`, `read:repository:bitbucket`,
  `read:pullrequest:bitbucket`, `read:pipeline:bitbucket`,
  `write:repository:bitbucket`, `write:pullrequest:bitbucket`.

### mysql executable not found

Settings → Database → mysql executable → укажи полный путь к `mysql.exe`.
Либо нажми "Use detected", если приложение нашло его по PATH.

### Port not detected

Бывает на проектах со специфичной ASP.NET-конфигурацией. Run работает,
кнопка "Open in browser" не появится — открывай URL руками.

### Stuck dotnet process

Если Stop не убивает: Task Manager → kill `dotnet.exe`. Через 2
секунды статус в приложении обновится.

### Pipelines таб пустой, хотя в Bitbucket pipeline'ы есть

Токен скорее всего без `read:pipeline:bitbucket` scope. Пересоздай
scoped-токен с этим scope (см. секцию Bitbucket токен).

## Сборка из исходников

```bash
git clone https://github.com/lukianovanton/workhelper.git
cd workhelper
npm install
npm run dev
```

### Публикация релиза

#### Однократная подготовка машины

- **Включи Windows Developer Mode**: Settings → Privacy & security
  → For developers → Developer Mode = ON. Без этого `electron-builder`
  падает на распаковке `winCodeSign` (внутри лежат macOS-симлинки).
- **Получи GitHub Personal Access Token**: github.com → Settings →
  Developer settings → Personal access tokens → Tokens (classic) →
  Generate new token (classic). Scope: `public_repo` (или `repo`
  для приватного репо). Срок — 90 дней или год.

#### Перед каждым релизом

1. Подними версию в `package.json` — electron-builder сравнивает с
   существующими тегами на GitHub.
2. В свежем PowerShell:

   ```powershell
   $env:GH_TOKEN = "ghp_xxx"
   npm run release
   ```

   Для других шеллов — `GH_TOKEN=ghp_xxx npm run release` (bash) или
   `set GH_TOKEN=ghp_xxx` затем `npm run release` (cmd).

   Токен — секрет. Не коммить, не вставляй в чат.

3. `electron-vite build` + `electron-builder` соберут установщик
   (`dist\WorkHelper Setup X.X.X.exe`) + `latest.yml` + `.blockmap`
   и зальют их в **draft release** на GitHub.

4. На странице
   [github.com/lukianovanton/workhelper/releases](https://github.com/lukianovanton/workhelper/releases)
   → найди draft → допиши release notes → **Publish release**. Без
   этого auto-updater у пользователей обновление не увидит.

5. Установленные приложения подхватят обновление при следующем
   запуске и применят при перезапуске.

6. Закрой PowerShell — `GH_TOKEN` исчезнет.

### Структура проекта

- `src/main/` — Electron main process (Node.js, services + IPC)
- `src/renderer/` — React UI на чистом JS
- `src/preload/` — мост через contextBridge
- `src/renderer/src/i18n/` — словари EN/RU + хук `useT()`
- `src/renderer/src/components/` — общие UI-кирпичи (states.jsx,
  setup-guides/, adf-renderer.jsx, ...)

Stack: Electron 32 + React 18 + Tailwind v4 + shadcn/ui +
electron-vite + Zustand + TanStack Query.

## Известные ограничения

- Только Windows (тестируется на Win 10/11 x64)
- Только MySQL для DB-операций
- App passwords Bitbucket не поддерживаются — только API tokens
- Running dotnet процессы убиваются при перезапуске приложения
  (by design — иначе становятся zombie)
- Setup guides в Settings всегда на английском (в них много
  технических ссылок на англоязычные доки Atlassian / MySQL)
