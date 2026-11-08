// A file a person attached in a conversation with their Operator is kept in
// the bucket under its space, named by the digest of its bytes
// (operator-channels.ts `keepFile`). That digest is its attachment id: what
// the conversation calls it, and what library_add and sandbox_write read it by.
import type { Space } from './directory.ts'
import type { Env } from './env.ts'
import { refuse } from './tool.ts'

/** Where the attachment with this digest is kept in the space's bucket.
 *
 * ```ts
 * import { attachmentKey } from './attachments.ts'
 * import { assertEquals } from '@std/assert'
 * assertEquals(attachmentKey({ store: 'ada' }, 'c0ffee'), 'ada/.operator/c0ffee')
 * ```
 */
export let attachmentKey = (space: Pick<Space, 'store'>, sha: string) =>
  `${space.store}/.operator/${sha}`

/** The bytes of the space's attachment by its id, or null when the space
 * keeps none by it; an id that cannot be one is refused. */
export let attached = async (
  env: Pick<Env, 'BLOBS'>,
  space: Pick<Space, 'store'>,
  id: string,
): Promise<Uint8Array<ArrayBuffer> | null> => {
  if (!/^[0-9a-f]{64}$/.test(id)) {
    throw refuse('arguments', `attachment: ${id} is not an attachment id`)
  }
  let kept = await env.BLOBS.get(attachmentKey(space, id))
  return kept && new Uint8Array(await kept.arrayBuffer())
}
