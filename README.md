# WorkHelper

Desktop app для управления проектами из Bitbucket workspace.
Один клик — клонирование, БД, восстановление дампа, запуск .NET-проекта.

## Скриншоты

(placeholder — добавлю отдельно)

## Установка для пользователей

1. Скачать `WorkHelper Setup X.X.X.exe` со страницы
   [Releases](https://github.com/lukianovanton/workhelper/releases/latest)
2. Запустить, следовать установщику
3. Запустить через ярлык на рабочем столе
4. Приложение само проверяет обновления и устанавливает при
   следующем запуске

### Системные требования

- Windows 10/11 x64
- Установлены: git, .NET SDK 9+, MySQL 8 локально
- Желательно: VS Code в PATH

## Первая настройка

После запуска — Settings (⚙ слева внизу). Заполнить четыре блока:

### Bitbucket

- **Workspace**: `techgurusit`
- **Email**: твой Atlassian email
- **Bitbucket username**: bitbucket username (не email — найди на
  bitbucket.org/account/settings)
- **API token**: id.atlassian.com → Security → Create API token with
  scopes → Bitbucket → отметить:
  - read:account
  - read:workspace:bitbucket
  - read:repository:bitbucket
  - write:repository:bitbucket
  - read:pipeline:bitbucket

  Срок жизни — 1 год. Скопируй токен сразу, повторно показан не будет.

После Save → Test connection → должна загореться зелёная галочка.

### Paths

- **Projects folder** — куда клонируются репо (`C:\Projects`)
- **Dumps folder** — где лежат бэкапы БД (`C:\Dumps`)
- **VS Code path** — обычно `code` в PATH

### Database

- **Host**: `localhost`
- **Port**: `3306`
- **User**: `root`
- **Password**: твой пароль
- **mysql executable**: путь к `mysql.exe`, обычно
  `C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe`

Test connection → должна показать MySQL версию.

## Использование

### Главный экран

Список репозиториев из Bitbucket workspace. Точки слева:

- 🟢 / ⚪ склонирован локально
- 🟢 / ⚪ есть БД с именем slug
- 🟡 есть несохранённые изменения
- 🔵 проект сейчас запущен

Сортировка — клик по заголовку колонки. Фильтры — в sidebar.

### Один клик: Setup & Run

Клик на не-склонированный проект → drawer → **Setup & Run**.
Открывается диалог с pre-flight (что будет сделано):

- clone из Bitbucket
- create database с именем slug
- restore из дампа в Dumps folder (автодетект)
- open in VS Code
- start dotnet (по галочке)

Если в Dumps folder есть файл с именем `{slug}*` или `dump-{slug}*` —
будет использован автоматически (самый свежий по дате).

Жмёшь Start → видишь прогресс по шагам → проект запущен.

### Работа с установленным проектом

В drawer проекта:

- **Pull** — git pull
- **Run / Stop (:port)** — запуск/остановка dotnet
- 🌐 рядом со Stop — открыть `http://localhost:{port}` в браузере
- **Open in VS Code** — открыть в редакторе
- **Restore from {filename}** или **Restore from file…** — обновить БД
- **Drop database** — удалить БД (с подтверждением)

### Дампы БД

Автодетект ищет в Dumps folder файлы по имени:

- `{slug}*` (например `p0070.sql`)
- `dump-{slug}*` (например `dump-P0070-2026-04-01`)

Регистр не важен. Берётся самый свежий по mtime. Формат — любой
text-based MySQL dump (расширение не важно) или его gzip-сжатая
версия. Определяется по содержимому.

## Troubleshooting

### Clone fails: authentication

Один раз клонируй вручную:

```
git clone https://{your-username}@bitbucket.org/{workspace}/{slug}.git
```

Windows Credential Manager закэширует доступ, дальше приложение
будет работать.

### mysql executable not found

Settings → Database → mysql executable: укажи полный путь к
`mysql.exe`.

### Port not detected

Бывает на проектах со специфичной ASP.NET-конфигурацией. Run
работает, кнопка "Open in browser" не появится. Открывай руками.

### Stuck dotnet process

Если Stop не убивает: Task Manager → kill `dotnet.exe`. Через 2
секунды статус в приложении обновится.

## Сборка из исходников

```
git clone https://github.com/lukianovanton/workhelper.git
cd workhelper
npm install
npm run dev
```

### Публикация релиза

#### Однократная подготовка машины

- **Включи Windows Developer Mode**: Settings → Privacy & security
  → For developers → Developer Mode = ON. Без этого
  `electron-builder` падает на распаковке `winCodeSign` (в архиве
  внутри лежат macOS-симлинки, для создания которых обычному юзеру
  нужны права; альтернатива — разово запускать терминал «As
  Administrator»).
- **Получи GitHub Personal Access Token**: github.com → Settings →
  Developer settings → Personal access tokens → Tokens (classic) →
  Generate new token (classic). Scope: `public_repo` (или `repo`
  если репозиторий приватный). Срок — 90 дней или 1 год.

#### Перед каждым релизом

1. **Подними версию** в `package.json` (`0.1.0` → `0.1.1`).
   electron-builder сравнивает с уже существующими тегами на
   GitHub — пытаться выложить ту же версию второй раз бессмысленно.

2. **Открой свежий PowerShell в папке проекта** и выполни:

   ```powershell
   $env:GH_TOKEN = "ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
   npm run release
   ```

   Альтернативы для других шеллов:

   ```bash
   # git-bash — токен живёт только для одной команды
   GH_TOKEN="ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" npm run release
   ```

   ```cmd
   :: cmd.exe
   set GH_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   npm run release
   ```

   Токен — секрет. Не коммить, не вставляй в чат, не сохраняй в
   `.env`. Переменная окружения умирает с закрытием окна шелла —
   так и должно быть. GitHub автоматически отзывает токены,
   попавшие в публичный код.

3. `electron-vite build` соберёт бандлы, `electron-builder` создаст
   `dist\WorkHelper Setup X.X.X.exe`, `latest.yml`, `.blockmap` и
   зальёт их в **draft release** на github.com.

4. Открой
   [github.com/lukianovanton/workhelper/releases](https://github.com/lukianovanton/workhelper/releases) →
   найди draft → допиши release notes → **Publish release**. Без
   этого шага auto-updater у пользователей обновление не увидит.

5. Установленные у пользователей приложения подхватят обновление
   при следующем запуске и применят при перезапуске.

6. Закрой окно PowerShell — `GH_TOKEN` исчезнет из памяти. Если
   случайно протёк (вставил в чат, закоммитил, отправил коллеге) —
   немедленно `Settings → Personal access tokens → Revoke` и создай
   новый.

### Структура проекта

См. `project-hub-spec.md` — полная архитектурная спецификация.

- `src/main/` — Electron main process (Node.js)
- `src/renderer/` — React UI на чистом JS
- `src/preload/` — мост через contextBridge

Stack: Electron 32 + React 18 + Tailwind v4 + shadcn/ui +
electron-vite + Zustand + TanStack Query.

## Известные ограничения

- Только Windows (тестируется на Win 10/11 x64)
- Только MySQL
- App passwords Bitbucket не поддерживаются — только API tokens
- Running dotnet процессы убиваются при перезапуске приложения
  (by design, иначе становятся zombie)
