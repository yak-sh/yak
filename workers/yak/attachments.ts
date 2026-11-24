// A file or message text from a conversation with the Operator is kept in
// the bucket under its space, named by the digest of its bytes
// (operator-channels.ts `keepFile`). That digest is its attachment id: what
// the conversation calls it, and what library_add and sandbox_write read it by.
import { artifactBytes, type Blobs, prefixed } from '@yaks/blob'
import type { Space } from './directory.ts'
import type { Env } from './env.ts'
import { r2Objects } from './lib/objects.ts'
import { refuse } from './tool.ts'
import { operatorDoor } from './build-door.ts'
import type { Who } from './session.ts'
import type { Bundle } from '@yaks/graph'

/** Where the space keeps the Operator's attachments in the bucket. */
let attachmentPrefix = (space: Pick<Space, 'store'>) =>
  `${space.store}/.operator/`

/** Where the attachment with this digest is kept in the space's bucket.
 *
 * ```ts
 * import { attachmentKey } from './attachments.ts'
 * import { assertEquals } from '@std/assert'
 * assertEquals(attachmentKey({ store: 'ada' }, 'c0ffee'), 'ada/.operator/c0ffee')
 * ```
 */
export let attachmentKey = (space: Pick<Space, 'store'>, sha: string) =>
  attachmentPrefix(space) + sha

/** The space's Operator attachments, a @yaks/blob store under their prefix,
 * counted as every trip to the bucket is (lib/objects.ts). */
export let attachments = (
  env: Pick<Env, 'BLOBS'>,
  space: Pick<Space, 'store'>,
): Blobs => prefixed(r2Objects(env.BLOBS), attachmentPrefix(space))

/** The bytes of the space's attachment by its id, or null when the space
 * keeps none by it; an id that cannot be one is refused, and bytes that are
 * not the ones it names throw (@yaks/blob `artifactBytes`). */
export let attached = async (
  env: Pick<Env, 'BLOBS'>,
  space: Pick<Space, 'store'>,
  id: string,
): Promise<Uint8Array<ArrayBuffer> | null> => {
  if (!/^[0-9a-f]{64}$/.test(id)) {
    throw refuse('arguments', `attachment: ${id} is not an attachment id`)
  }
  let kept = await artifactBytes(attachments(env, space), { address: id })
  return (kept ?? null) as Uint8Array<ArrayBuffer> | null
}

/** An attachment where a caller requires its bytes, refused when absent. */
export let attachmentBytes = async (
  env: Env,
  space: Space,
  id: string,
  who: Who,
) => {
  await requireAttachment(env, space, id, who)
  return present(space, id, await attached(env, space, id))
}

/** The same attachment, with its length and a streaming body. */
export let attachmentStream = async (
  env: Env,
  space: Space,
  id: string,
  who: Who,
) => {
  await requireAttachment(env, space, id, who)
  return present(space, id, await openedAttachment(env, space, id))
}

/** Open bytes of an attachment after the caller has authorized the space. */
export let openedAttachment = async (env: Env, space: Space, id: string) => {
  if (!/^[0-9a-f]{64}$/.test(id)) {
    throw refuse('arguments', `attachment: ${id} is not an attachment id`)
  }
  let source = await attachments(env, space).open!(id)
  return source && { sha: id, size: source.size, stream: await source.read() }
}

let present = <T>(space: Space, id: string, value: T | null): T => {
  if (value == null) {
    throw refuse('missing', `${space.slug} keeps no attachment ${id}`)
  }
  return value
}

let requireAttachment = async (
  env: Env,
  space: Space,
  id: string,
  who: Who,
) => {
  if (!/^[0-9a-f]{64}$/.test(id)) {
    throw refuse('arguments', `attachment: ${id} is not an attachment id`)
  }
  let rows = await operatorDoor(env, space, who, 'attachments', {
    q: `.attachment.artifact=${id}&*`,
  }) as Bundle[]
  let allowed = rows.some((row) =>
    (row.attachment as { artifact?: string } | undefined)?.artifact == id
  )
  if (!allowed) present(space, id, null)
}

/** Original UTF-8 text, without replacing invalid bytes or dropping a BOM. */
export let attachmentText = (bytes: Uint8Array) => {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
      bytes,
    )
  } catch (error) {
    if (!(error instanceof TypeError)) throw error
    throw refuse('arguments', 'This attachment is not valid UTF-8 text.')
  }
}
