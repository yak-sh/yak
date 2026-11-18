// An app's uploads in its own words, on yaks.app and on a box alike: the
// content, `blob{bytes}` at the bytes' address with what a picture measures
// as `image{w, h}`, and the use of it, `attachment{blob, mime, name}`
// (./app-vocab.ts). Its pages read both (files.md), so these are the words
// every host's file door writes for an app (@yaks/blob/routes `naming`). A
// model's media is an `artifact` (@yaks/blob), which an attachment may name
// instead.
import type { Bundle, Comp } from '@yaks/graph'
import { token } from '@yaks/graph/sha256'
import { line } from '@yaks/query'
import type { Naming } from '@yaks/blob/upload'

/** Where an app's file door answers, beside its pages. */
export let UPLOADS = '/api/blob/'

let comp = (rows: Bundle[], eid: string, name: string) =>
  rows.find((r) => r.entity.eid == eid)?.[name] as Comp | undefined

let text = (v: unknown) => typeof v == 'string' ? v : ''

/** The rows naming an app's uploads, and what they say. Bytes none of
 * `names` answers for are served no more, and retained for recovery from trash. */
export let uploads: Naming = {
  rows: ({ sha, use, mime, name, bytes, size }) => [
    { entity: { eid: sha }, blob: { bytes }, ...size ? { image: size } : {} },
    {
      entity: { eid: use },
      attachment: { blob: sha, mime, ...name ? { name } : {} },
    },
  ],
  said: (rows, { sha, use }) => {
    let file = comp(rows, use, 'attachment')
    if (file) {
      return {
        mime: text(file.mime),
        name: text(file.name),
        fix: (mime) => [{
          entity: { eid: use },
          attachment: { mime },
          $was: {
            attachment: {
              blob: token(file.blob),
              mime: token(file.mime),
              name: token(file.name),
            },
          },
        }],
      }
    }
    let artifact = comp(rows, sha, 'artifact')
    return artifact
      ? {
        mime: text(artifact.media_type),
        name: '',
        fix: (mime) => [{
          entity: { eid: sha },
          artifact: { media_type: mime },
          $was: { artifact: { media_type: token(artifact.media_type) } },
        }],
      }
      : null
  },
  // The content row while it carries the bytes (an upload's `blob`, a
  // model's `artifact`), and any attachment pointing at them.
  names: (sha) =>
    line`.entity.eid=${sha} .blob|.entity.eid=${sha} .artifact|.attachment.blob=${sha}|.attachment.artifact=${sha}`,
}
