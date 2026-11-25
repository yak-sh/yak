/** A name made possessive: "Ada’s", but a name ending in s takes the bare
 * apostrophe, "checks’" and "James’".
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { possessive } from '@yaks/text/possessive'
 *
 * assertEquals(possessive('Ada'), 'Ada’s')
 * assertEquals(possessive('James'), 'James’')
 * ```
 *
 * @module
 */
export let possessive = (name: string): string =>
  /s$/i.test(name) ? `${name}’` : `${name}’s`
