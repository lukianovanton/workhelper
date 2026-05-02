# MEGA-FIX report (mega-fix branch → v0.8.0)

Цель: довести WorkHelper до автоматизации запуска ЛЮБОГО
проекта — без ручных установок toolchain'а пользователем.

Triggering case: `pullum_shop` падал на `npm install` с
`gyp ERR! not ok`. После Phase 0 диагностики стало ясно — у
юзера на машине нет Visual Studio Build Tools и нет Python,
а на Node 24 это вообще не лечится без них.

## Что сделано

### Phase 0 — Diagnostic (commit `68fcc94`)

Реальные измерения с машины владельца. Результаты в
[`diagnostic.md`](./diagnostic.md). Ключевые выводы:

- 14 .NET проектов, все net8.0/net9.0 → **уже работают** (SDK
  установлены)
- 4 Node проекта, из них критичный — `pullum_shop` с
  `node-sass@^7.0.1`
- На машине **нет**: VS Build Tools, Python, Volta, mysql/psql
  в PATH (хотя сами БД установлены)
- На машине **есть**: Node 24.13.1, .NET 8+9, Git, MySQL 8,
  PostgreSQL 17, winget

Strategy revision: **скипнуть** DB auto-provisioning (юзер
БД уже имеет) и .NET SDK installer (8+9 покрывают всё) и
сфокусироваться на VS Build Tools + Python — они основной
блокер.

### Phase 1 — Build verify

`npm run build` clean без изменений. Никаких регрессий перед
началом работы.

### Phase 2a-d — Backend toolchain detect/install (commit `1567ed0`)

Создано:

- [`src/main/services/toolchain/build-tools.js`](src/main/services/toolchain/build-tools.js)
  - `getBuildToolsInfo()` — `vswhere -all -products * -format json`,
    проверка `<inst>/VC/Tools/MSVC/<ver>/` для подтверждения
    наличия компилятора (vswhere может найти VS без MSVC).
  - `installBuildTools()` — direct download
    `aka.ms/vs/17/release/vs_BuildTools.exe`, запуск с
    `--add Microsoft.VisualStudio.Workload.VCTools
    --includeRecommended --quiet --wait --norestart`.
    UAC-prompt на старте; дальше silent. Exit code 0/3010 =
    success, 1602 = user cancel.

- [`src/main/services/toolchain/python.js`](src/main/services/toolchain/python.js)
  - `getPythonInfo()` — пробует `py`/`python`/`python3` в
    порядке по платформе. Игнорирует Microsoft Store stub
    (паттерн «not found» в выводе).
  - `installPython()` — direct download
    `python.org/ftp/python/3.12.7/python-3.12.7-amd64.exe`,
    `/quiet InstallAllUsers=0 PrependPath=1` — per-user, **no
    UAC**.
  - `ensurePythonInPath()` — пушит свежеустановленный bin-dir
    в `process.env.PATH` без рестарта приложения.

- [`src/main/services/toolchain/manager.js`](src/main/services/toolchain/manager.js)
  - `NATIVE_BUILD_DEPS` — список 17 native-deps (node-sass,
    bcrypt, sharp, canvas, sqlite3, etc.) — критерий «нужен
    компилятор».
  - `detectProjectRequirements(repoPath)` — анализирует
    package.json на пересечение с этим списком + required
    Node version.
  - `getToolchainState()` — кэшируемый snapshot (TTL 60s).
  - `getMissingTools(req, state)` — диф «что хочет проект» vs
    «что есть».

- [`src/main/ipc/toolchain.ipc.js`](src/main/ipc/toolchain.ipc.js)
  - `toolchain:status(slug)` — сводка + per-project gap.
  - `toolchain:installBuildTools()` / `installPython()`.
  - `toolchain:invalidateCache()`.
  - `api.toolchain.*` в preload.

### Phase 2e + 2f + 3 — UI + orchestrator + error parser (commit `d09cdfa`)

- **`ToolchainBanner`** в Setup-dialog'е (`setup-dialog.jsx`):
  - Скрыт для проектов без native deps.
  - 🟢 «Native build toolchain ready» — всё стоит.
  - 🟡 «Project has native dependencies …. Missing on this machine: …»
    + кнопки `Install Build Tools (UAC)` / `Install Python`.
  - Кнопки disabled пока что-то ставится; live-обновление статуса
    после успешной install'ки (cache invalidate + refetch).
  - Тонкая подсказка пока Build Tools качается («~5–15 минут,
    ~2 GB download. The system progress dialog may appear
    briefly. You can leave this dialog open»).

- **`toolchain-prep` step в orchestrator'е** (`setup-orchestrator.js`):
  Между db-restore и node-prep. Только **детектит**, не запускает
  install'ы — Build Tools требует UAC, юзер должен решить через
  banner. Эмитит:
  - «No native build tools required»
  - «Build toolchain ready»
  - «Missing: VS Build Tools + Python. Install via banner above…»

- **Error parser в runDepsStep**: если npm install всё-таки упал
  (юзер проигнорировал banner), парсит stderr/stdout на типичные
  паттерны (gyp + python, MSBUILD, cl.exe, abi mismatch, eacces,
  etarget) и добавляет конкретный actionable hint к ошибке.

### Phase 5 — Polish: Settings → Toolchain (commit `b3fdc41`)

Новая секция в Settings — общая сводка состояния машины с
кнопками установки. Полезна для **проактивной** установки
тулчейнов (не дожидаясь столкновения с проектом).

- Список: Node.js (display), Volta, Python, VS Build Tools.
- Точка-индикатор (emerald/muted) + версия + tooltip про размер
  и UAC.
- Refresh button для cache invalidate + re-detect.
- Use both side-by-side: Settings = proactive, Setup-dialog
  banner = reactive per-project.

`SectionCardHeader` расширен `right`-prop'ом для refresh-кнопки.

## Что НЕ сделано и почему

- **DB auto-provisioning** (Phase 4 в плане). Скипнуто намеренно:
  по диагностике у владельца MySQL 8 + Postgres 17 уже стоят
  natively. Auto-provisioning через Docker / EnterpriseDB-installer
  сейчас бессмыслен. Новые юзеры без БД — отдельная задача,
  ниже приоритет чем gyp-фикс.

- **.NET SDK auto-installer** (Phase 2 пункт). Скипнуто: у
  владельца SDK 8 + 9 покрывают все 14 .NET проектов. Если у
  гипотетического юзера будет проект с пинном в `global.json`
  на не-установленную версию — это известная дыра, которую
  лечит интеграция `dotnet-install.ps1`. Архитектурно tech-debt
  не накопил: добавление будет analogичным python.js.

- **mise / nvm-windows как замена Volta**. Volta уже работала и
  её UX — single binary + auto-PATH-shim — лучше для нашего
  случая чем mise (требует shell-init) или nvm-windows (не для
  всех версий). Решено: Volta остаётся.

- **Verify-step после установки** (Phase 5). Polish-задача
  частично сделана: `python.js` после install сразу пробует
  `ensurePythonInPath`. После Build Tools install — refresh в
  toolchain-cache даёт verify через следующий vswhere. Полного
  «run --version и убедись» отдельным шагом не делал — текущая
  логика effectively это и есть.

- **Streaming-логи установки в UI**. Build Tools installer
  работает silently без stdout — стримить нечего. Прогресс
  показывает Windows progress dialog. Для python — installer
  тоже silent. Если нужен fine-grained прогресс — отдельная
  задача (parsing log file).

- **Cancel-кнопка для долгих install'ов**. Пока нет —
  child.kill() возможен но Build Tools installer запустится в
  отдельном процессе и продолжит. Корректный cancel требует
  msi-aware abort, отложено.

## Verification

Тестировать на реальной системе требует:
1. Открыть `pullum_shop` в drawer → Setup remaining
2. Увидеть ToolchainBanner: «Project has native dependencies
   (node-sass, sass) which require system build tools to compile…»
3. Нажать `Install Python` (no UAC, ~25MB). Подождать ~30s.
4. Banner refetch → Python OK, остаётся build tools.
5. Нажать `Install Build Tools (UAC)`. UAC-prompt → Yes.
   Подождать ~10 минут (silent download + install).
6. Banner refetch → emerald «Native build toolchain ready».
7. Запустить Setup remaining → npm install теперь компилирует
   node-sass успешно.

(Live-test я выполнить не могу из текущего окружения; полагаюсь
на корректность интеграции по diagnostic'у и build verify.)

## Известные баги / risks

- Если `aka.ms/vs/17/release/vs_BuildTools.exe` redirect-link
  изменится Microsoft'ом, install сломается. Маловероятно
  (это публикуемая evergreen-ссылка в их docs), но риск есть.
  Mitigation: error message содержит exit code, юзер увидит
  что installer не запустился.

- Volta direct-download (commit `78c2d43` из v0.7.0) использует
  GitHub API. Rate-limit на anonymous = 60 req/hour — для
  обычного юзера за глаза.

- Python 3.12 hardcoded. Если node-gyp в будущем дропнет 3.12
  поддержку (3.13+ only), нужно бампать. Mitigation: тег версии
  в коде, легко сменить.

- VS Build Tools установка требует UAC. Если юзер откажется —
  exit code 1602, banner покажет «Installation cancelled».

## Что дальше

- DB auto-provisioning через Docker (если у юзера Docker есть)
  и через EnterpriseDB / MySQL Installer (если нет).
- .NET SDK installer когда понадобится (low priority пока всё
  работает).
- Streaming installer logs в expandable detail для UX.
- Cancel-кнопки для долгих процессов.
- Testing на чистой Windows VM без ничего установленного — даст
  honest feedback что ещё не покрыто.
