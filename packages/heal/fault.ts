// Catch boundaries share the reporting filter declared by @yaks/tools.

/**
 * Whether a failure is worth reporting: anything but a known transient.
 *
 * ```ts
 * import { actionable } from '@yaks/heal'
 *
 * actionable('fetch timed out') // false
 * actionable('no such table: bug') // true
 * ```
 */
export { actionable } from '@yaks/tools/fault'
