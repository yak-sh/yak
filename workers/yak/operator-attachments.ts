// An attachment is one use of immutable bytes, named by the message it
// arrived with. The artifact's address reads those bytes through attachments.ts.
import type { Bundle } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import { mediaTypeOf } from '@yaks/blob'
import type { File } from './operator-channels.ts'
import { attachmentKey } from './attachments.ts'
import type { Space } from './directory.ts'
import type { Env } from './env.ts'

/** The attachment's stable identity within the message that carried it. */
export let attachmentOf = (message: string, index: number) =>
  derivedEid(`operator-attachment|${message}|${index}`)

/** The bytes, and each use of them beside a message: replays patch the same
 * rows, while the same bytes sent with another message keep both names. */
export let attachmentRows = (message: string, files: File[]): Bundle[] =>
  files.flatMap((file, i) => {
    let sha = file.key.split('/').at(-1)!
    return [{
      entity: { eid: sha },
      artifact: {
        address: sha,
        media_type: file.mime,
        ...file.size == null ? {} : { size: file.size },
      },
    }, {
      entity: { eid: attachmentOf(message, i) },
      attachment: {
        name: file.name,
        media_type: file.mime,
        artifact: sha,
        message,
      },
    }]
  })

/** The artifact row of each file kept in the space that a decision's choices
 * show by its attachment id (@yaks/task `shows`), its media type read from
 * its first bytes. An id that names no kept file is left for the graph to
 * hold as it is. */
export let shownFiles = async (
  env: Pick<Env, 'BLOBS'>,
  space: Pick<Space, 'store'> | null,
  choices: unknown,
): Promise<Bundle[]> => {
  if (!space || !Array.isArray(choices)) return []
  let ids = [
    ...new Set(
      choices.map((c) => (c as { shows?: unknown })?.shows)
        .filter((id): id is string =>
          typeof id == 'string' && /^[0-9a-f]{64}$/.test(id)
        ),
    ),
  ]
  let rows = await Promise.all(ids.map(async (sha) => {
    let kept = await env.BLOBS.get(attachmentKey(space, sha), {
      range: { offset: 0, length: 64 },
    })
    if (!kept) return null
    let type = mediaTypeOf(new Uint8Array(await kept.arrayBuffer()))
    return {
      entity: { eid: sha },
      artifact: {
        address: sha,
        ...type ? { media_type: type } : {},
      },
    }
  }))
  return rows.filter((b) => !!b)
}
