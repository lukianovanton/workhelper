# WorkHelper diagnostic — baseline 2026-05-02

Phase 0 of MEGA-FIX. Real measurements from the owner's machine.
All secrets masked as `***`.

## Toolchain state

| Tool | Status | Version / path |
|---|---|---|
| Node.js | ✅ installed | v24.13.1 (system, `C:\Program Files\nodejs\node.exe`) |
| npm | ✅ | 11.8.0 |
| .NET SDK 8 | ✅ | 8.0.418 (`C:\Program Files\dotnet\sdk`) |
| .NET SDK 9 | ✅ | 9.0.311 |
| .NET runtime 8 | ✅ | 8.0.24 (AspNetCore + NETCore + WindowsDesktop) |
| .NET runtime 9 | ✅ | 9.0.13 |
| Python | ❌ **MISSING** | shim says "install from Microsoft Store" |
| Visual Studio Build Tools | ❌ **MISSING** | `vswhere -all -format json` returns `[]` |
| MSVC `cl.exe` | ❌ | not in PATH (consequence of no Build Tools) |
| MSBuild | ❌ | not in PATH |
| Git | ✅ | 2.53.0.windows.1 |
| MySQL Server 8 | ✅ | installed at `C:\Program Files\MySQL\MySQL Server 8.0` (mysql.exe NOT in PATH; workhelper config has hardcoded `executable` path) |
| PostgreSQL 17 | ✅ | installed at `C:\Program Files\PostgreSQL\17` (same — not in PATH but configured) |
| Docker Desktop | ⚠️ | dir exists at `C:\Program Files\Docker` but `docker --version` not in PATH (likely needs Docker Desktop running OR the command is `docker.exe`) |
| Volta | ❌ | not installed |
| winget | ✅ | v1.28.240 (used by App Installer; available) |

## WorkHelper config (masked)

`%APPDATA%\project-hub\config.json`:

- **paths**: `projectsRoot=C:\Projects`, `dumpsRoot=C:\Dumps`, vscode at standard user-local path
- **presence**: enabled
- **jira**: `techgurus.atlassian.net`, email `***`
- **sources**:
  1. Bitbucket — workspace `techgurusitatlassiannet`, gitUsername `antonreact1`
  2. GitHub — owner `lukianovanton`
  3. GitLab — namespace `lykianovlav`, baseUrl `https://gitlab.com`
- **databases**:
  1. MySQL — root@localhost:3306, executable hardcoded
  2. PostgreSQL — postgres@localhost:5432, executable hardcoded
- **runOverrides**: 5 entries (mostly `dotnet run` and `npm run start/dev`)
- **databaseOverrides**: 5 entries (4 with `skipDb`, 1 with explicit Postgres binding `qaaffcrm`)

## Project inventory (representative slice)

Total projects in `C:\Projects`: ~50+. Inspected 17.

### .NET projects (≈14 of inspected)

All `net8.0` or `net9.0`. User's installed SDKs (8.0.418, 9.0.311) cover both. **No SDK installation work needed for these projects** unless someone adds a `global.json` pinning a not-installed version.

Examples: `p0026`, `p0036`, `p0042`, `p0049`, `p0055`, `p0064`, `p0066`, `p0067`, `p0070`, `crm0042`, `crmac`, `affiliatecrm` (multi-project solution net9.0).

Multi-project pattern: `<Brand>/`, `<Brand>.BusinessLogic/`, `<Brand>.DataAccess/`, `<Brand>.Utils/` or shorter `BusinessLogic/`, `DataAccess/`, `<Brand>/`, `Utils/`.

### Node projects (4 of inspected)

| Slug | scripts.start / dev | Native deps | Risk |
|---|---|---|---|
| **pullum_shop** | `react-scripts --openssl-legacy-provider start` | **`node-sass@^7.0.1`** + `sass@^1.52.2` | 🔴 BLOCKED — node-sass v7 needs C++ compiler + Python; user has neither. Also node-sass v7 doesn't work on Node 24. |
| pullumnewyear_2024 | `react-scripts start` | only `sass` (Dart Sass, JS-only) | 🟡 May work on Node 24, react-scripts old versions are ABI-sensitive |
| mygame | `node server/index.js` | only `sass` | 🟢 should work |
| gitlabtest | `vite` | none | 🟢 should work |

None pin a Node version (no `engines.node`, no `.nvmrc`, no `package.json#volta.node`).

### Other (1)

`landings` — neither package.json nor csproj. Likely static HTML or just a folder. No setup needed.

## PROBLEM ANALYSIS

### Root cause for the failing case (pullum_shop)

`npm install` produces gyp build error. **Three independent missing pieces**:

1. **Visual Studio Build Tools missing** — `vswhere -all` returns empty array. node-sass runs node-gyp which invokes MSBuild to compile native bindings. Without Build Tools, no MSBuild, no compile.
2. **Python missing** — node-gyp's binding.gyp scripts are Python. The Python launcher reports "Python was not found".
3. **Node version mismatch** — node-sass v7 supports up to Node 17. User has Node 24. Even with Build Tools + Python, node-sass v7 likely fails to compile against Node 24's V8.

### What actually fixes pullum_shop

Cleanest fix path — install all three:
1. Visual Studio Build Tools (Workload `Microsoft.VisualStudio.Workload.VCTools` — single component, no Visual Studio IDE needed; ~2GB)
2. Python (3.x — node-gyp dropped Python 2 long ago)
3. Node 16 via Volta (already implemented, just need to use it)

### Other Node projects (gitlabtest, mygame, pullumnewyear_2024)

Probably work on Node 24 native — they only have JS-based `sass`. The orchestrator's `npm install` should succeed for them. If not, falls into the same triad above.

### .NET projects

All currently work — user has SDK 8 and 9, both .NET runtimes installed. **No tooling work needed**.

### Database situation

Both MySQL 8 and PostgreSQL 17 are installed natively. Their executables are not in PATH but workhelper config has the absolute paths. **DB auto-provisioning is NOT a blocker for the user's current projects** — they already have working DB engines.

DB auto-provisioning would be valuable for *new* users without DBs installed. Lower priority than the gyp fix.

## What is NOT known yet

- Exact MSI URL pattern for Build Tools 2022 latest (will hit `https://aka.ms/vs/17/release/vs_BuildTools.exe` which is the documented evergreen redirect)
- Whether `vs_BuildTools.exe` returns a sensible exit code in `--quiet --wait` mode (need to test live)
- Whether installing per-user MSIs of MySQL / Postgres works without admin (out of scope for this round; user has both anyway)
- Exact UAC prompt count for Build Tools install (1 prompt expected at start; subsequent prompts unlikely with `--quiet`)

## Strategy for subsequent phases

Given user-specific reality (.NET fully covered, DBs installed, only Node gyp blocked):

**Highest leverage** = VS Build Tools auto-installer + Python auto-installer + integrate Volta + native-deps detection in package.json.

**Skip for now** (already works for this user):
- DB auto-provisioning
- .NET SDK auto-installer (user has 8 and 9; only relevant for some hypothetical project pinning .NET 7)

**Keep existing**:
- Volta integration (Phase 1) — useful for Node version pinning, just needs to flow through correctly.
