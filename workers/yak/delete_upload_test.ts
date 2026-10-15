// Deleting an upload: the row at the upload's eid goes, and the bytes leave the
// app's bucket with it (facets/app-effects.ts `delete_upload`), unless a row
// the app keeps still names them. `released` is that decision, read here over a
// graph holding the rows and a bucket recording what it is asked to delete.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { blobPrefix, released } from './blob-key.ts'
import { storeWords } from './vocab.ts'

let vocab = storeWords('app').vocab
let prefix = blobPrefix({ slug: 'ada' }, { slug: 'cookbook' })
let sha = (n: number) => String(n).repeat(64)

// The app's rows, as the uploads left them: sha(1) has none, sha(2) is
// uploaded again meanwhile, so its content row is back, and sha(3) is a
// generated file, named by an attachment past its upload's row.
let g = graph({ vocab, storage: ram(vocab) })
await g.apply([
  { entity: { eid: sha(2) }, blob: { bytes: 3 } },
  { entity: { eid: sha(3) }, attachment: { artifact: sha(3) } },
])

test('deleting an upload deletes its bytes, unless a row still names them', async () => {
  let deleted: string[] = []
  let bucket = {
    delete: (keys: string | string[]) => {
      deleted.push(...[keys].flat())
      return Promise.resolve()
    },
  }
  let release = (n: number) => released(g, bucket, prefix, sha(n))
  assertEquals(
    [await release(1), await release(2), await release(3)],
    [true, false, false],
  )
  assertEquals(deleted, [prefix + sha(1)])
})
