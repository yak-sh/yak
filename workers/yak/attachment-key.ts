import type { Space } from './directory.ts'

/** Where the space keeps the Operator's attachments in the bucket. */
export let attachmentPrefix = (space: Pick<Space, 'store'>) =>
  `${space.store}/.operator/`

/** Where the attachment with this digest is kept in the space's bucket.
 *
 * ```ts
 * import { attachmentKey } from './attachment-key.ts'
 * import { assertEquals } from '@std/assert'
 * assertEquals(attachmentKey({ store: 'ada' }, 'c0ffee'), 'ada/.operator/c0ffee')
 * ```
 */
export let attachmentKey = (space: Pick<Space, 'store'>, sha: string) =>
  attachmentPrefix(space) + sha
