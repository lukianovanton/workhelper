/**
 * Тонкая обёртка над window.api с JSDoc для intellisense.
 * Реализации IPC-хендлеров появляются в main по мере MVP.
 *
 * @typedef {import('@shared/types.js').Project} Project
 * @typedef {import('@shared/types.js').AppConfig} AppConfig
 */

/** @type {typeof window.api} */
export const api = window.api
