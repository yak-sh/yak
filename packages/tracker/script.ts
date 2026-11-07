// The page reporter's source (./page.js) as text, for a server weaving it
// inline into a page it serves. Read beside this module, wherever the package
// is served from (@yaks/api/asset): a checkout's file, or JSR's, kept in Deno's
// module cache.

import { text } from '@yaks/api/asset'

/** The page reporter's source.
 *
 * ```ts
 * import { assert } from '@std/assert'
 * assert((await script()).includes('api/report'))
 * ```
 */
export let script = (): Promise<string> =>
  text(new URL('./page.js', import.meta.url))
