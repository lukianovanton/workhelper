/**
 * Side-effect boot-модуль. Импортируется ПЕРВЫМ в main/index.js, до
 * любых других import'ов которые могут создать electron-store-инстанс
 * или прочитать app.getPath('userData').
 *
 * Цель — синхронизировать userData-каталог между dev (npm run dev) и
 * prod (упакованным exe). По умолчанию Electron'у app.name берётся из
 * package.json.name ("project-hub" → %APPDATA%/project-hub/), а в prod
 * electron-builder выставляет productName в "WorkHelper" → отдельный
 * каталог. В итоге config / localStorage хранились в разных местах,
 * dev и prod не синхронизировались.
 *
 * Принудительно ставим имя 'WorkHelper' в обоих режимах ПЕРЕД тем,
 * как кто-то прочитает userData-путь. ES-modules гарантируют, что
 * import './boot.js' first в entrypoint'е выполнит этот код первым
 * (до evaluation других модулей по source-order).
 *
 * Существующие dev-настройки лежат в %APPDATA%/project-hub/. После
 * этого изменения dev-режим начнёт читать %APPDATA%/WorkHelper/. Если
 * хочешь перенести данные — скопируй содержимое старого каталога в
 * новый один раз вручную (config.json + Local Storage/leveldb/*).
 */

import { app } from 'electron'

app.setName('WorkHelper')
