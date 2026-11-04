// The page reporter's source (./page.js) as text, for a server weaving it
// inline into a page it serves. Read beside this module, wherever the package
// is served from: a checkout's file, or JSR's https.

/** The page reporter's source.
 *
 * ```ts
 * import { assert } from '@std/assert'
 * assert((await script()).includes('api/report'))
 * ```
 */
export let script = (): Promise<string> =>
  fetch(new URL('./page.js', import.meta.url)).then((r) => r.text())
