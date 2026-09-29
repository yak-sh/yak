/**
 * @yaks/testing — what a test needs beside the code it tests.
 *
 * `tick` yields one macrotask and `until` polls a fact, so a test waits on
 * what it expects instead of sleeping a guessed span:
 *
 * ```ts
 * import { until } from '@yaks/testing'
 *
 * let ready = false
 * setTimeout(() => ready = true)
 * await until(() => ready, { label: 'ready' })
 * ```
 *
 * @module
 */
export { tick, until, type Wait } from './wait.ts'
