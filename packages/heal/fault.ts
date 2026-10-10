// Exception writers and heal use the same reporting filter.

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
export { actionable } from '@yaks/tools'
