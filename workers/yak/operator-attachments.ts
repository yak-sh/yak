// An attachment is one use of immutable bytes, named by the message it
// arrived with. The artifact's address reads those bytes through attachments.ts.
import type { Bundle } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import type { File } from './operator-channels.ts'

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
