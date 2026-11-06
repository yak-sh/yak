// Deleting an upload: the row at the upload's eid goes, and the bytes leave the
// app's bucket with it (facets/app-effects.ts `delete_upload`), unless a row
// the app keeps still names them. Who may delete that row is the app's write
// guard (graph.ts `appGuard`), whether bytes are still served is `servable`,
// and whether they leave the bucket is `released`: each checks its own seam
// over the rows an upload writes (apps.ts `filed`).
import { test } from '@yaks/testing'
import { assertEquals, assertThrows } from '@std/assert'
import { type Bundle, graph, mint, sha256, signed } from '@yaks/graph'
import { representation } from '@yaks/blob'
import { Denied } from '@yaks/member'
import { matcher, type Query } from '@yaks/match'
import { ram } from '@yaks/ram'
import { blobPrefix, naming, released, servable } from './blob-key.ts'
import { appGuard } from './app-authority.ts'
import { loadVocab, pick } from '@yaks/vocab'
import { spineDoc } from '@yaks/kernel/vocab'
import { provenanceDoc } from '@yaks/provenance/vocab'
import { artifactDoc } from '@yaks/blob/vocab'
import { memberDoc } from '@yaks/member/vocab'
import { kernelDoc as uploadDoc } from './facets/app-vocab.ts'

let vocab = loadVocab([
  spineDoc,
  provenanceDoc,
  memberDoc,
  pick(artifactDoc, ['artifact', 'representation']),
  pick(uploadDoc, ['blob', 'attachment']),
])

let prefix = blobPrefix({ store: 'ada' }, { slug: 'cookbook' })
let sha = (n: number) => String(n).repeat(64)

// The app's rows, as the uploads left them: sha(1) has none, sha(2) is
// uploaded again meanwhile, so its content row is back, and sha(3) is a
// generated file, named by an attachment past its upload's row.
let keptRows = [
  { entity: { eid: sha(2) }, blob: { bytes: 3 } },
  { entity: { eid: sha(3) }, attachment: { artifact: sha(3) } },
]
let plans = new Map(
  [1, 2, 3].map((n) => [naming(sha(n)), matcher(naming(sha(n)), vocab)]),
)
let kept = {
  read: (q: Query) => (plans.get(String(q)) ?? matcher(q, vocab))(keptRows),
}

for (
  let [n, erased, reason] of [
    [1, true, 'no row names its bytes'],
    [2, false, 'another upload names its bytes'],
    [3, false, 'an attachment names its bytes'],
  ] as [number, boolean, string][]
) {
  let deleted: string[] = []
  let bucket = {
    delete: (keys: string | string[]) => {
      deleted.push(...[keys].flat())
      return Promise.resolve()
    },
  }
  test(
    n == 1
      ? 'deleting an upload deletes its bytes, unless a row still names them'
      : `deleting an upload keeps bytes when ${reason}`,
    async () => {
      assertEquals(await released(kept, bucket, prefix, sha(n)), erased)
      assertEquals(deleted, erased ? [prefix + sha(n)] : [])
    },
  )
}

// An open cookbook, its store guarded as the platform guards it: Ada owns it,
// and a stranger holds no level on it, so the app's mode lets them in. A
// person's write goes through the guard; the kernel's (an upload's rows, signed
// as the uploader, apps.ts `took`) stands outside it, over the same rows.
let ADA = 'a0000000-0000-4000-8000-0000000000a0'
let STRANGER = 'b0000000-0000-4000-8000-0000000000b0'
let app = {
  eid: 'c0000000-0000-4000-8000-0000000000c0',
  slug: 'cookbook',
}
let rows = ram(vocab)
let kernel = graph({ vocab, storage: rows })
let guard = appGuard(app.eid, vocab, {}, {
  level: (who) => who == ADA ? 'owner' : null,
})
let cookbook = graph({ vocab, storage: rows, plugins: [guard] })
await kernel.apply([{ entity: { eid: app.eid }, access: { mode: 'open' } }], {
  trusted: true,
})
let as = (who: string) => ({
  upload: async (text: string) => {
    let sha = sha256(text)
    let rep = representation(app.eid, sha, 'text/plain')
    let bundles: Bundle[] = [
      { entity: { eid: sha }, blob: { bytes: text.length } },
      { entity: { eid: rep.eid }, representation: rep.row },
      {
        entity: { eid: mint() },
        attachment: { blob: sha, mime: 'text/plain' },
      },
    ]
    let wrote = () =>
      kernel.apply(signed(bundles, { by: who }), { trusted: true })
    await wrote()
    return { sha, eid: rep.eid, again: wrote }
  },
  drop: async (eid: string) =>
    await cookbook.apply(
      signed([{ entity: { eid }, $delete: true } as Bundle], { by: who }),
    ),
})

let ada = as(ADA), stranger = as(STRANGER)
let cake = await ada.upload('the cake')
let pie = await stranger.upload('their pie')
let tart = await stranger.upload('their tart')
let bread = await ada.upload('the bread')
// An upload since deleted, its representation left behind.
let bun = await ada.upload('the bun')
await kernel.apply([{ entity: { eid: bun.sha }, $delete: true }], {
  trusted: true,
})
let held = (...uploads: { sha: string }[]) =>
  rows.get(uploads.map((upload) => upload.sha), ['blob'])
    .filter((row) => row.blob).map((row) => row.entity.eid)
let serveRows: Bundle[]
let serving = new Map<string, ReturnType<typeof matcher>>()
let read = (q: string) =>
  Promise.resolve((serving.get(q) ?? matcher(q, vocab))(serveRows))
let served = async (upload: { sha: string; eid: string }, of = app) =>
  (await servable(read, of, upload.sha, upload.eid))?.address ?? null

test('a stranger cannot delete someone else’s upload', () => {
  let patch = signed([{ entity: { eid: cake.sha }, $delete: true } as Bundle], {
    by: STRANGER,
  })
  assertThrows(
    () => rows.tx((tx) => guard.hooks!.precondition!(patch, tx)),
    Denied,
  )
  assertEquals(held(cake), [cake.sha])
})

test('a stranger deletes only the uploads they made', async () => {
  await stranger.drop(pie.sha)
  assertEquals(await held(cake, pie), [cake.sha])
})

test("an app's owner deletes anyone's upload", async () => {
  await ada.drop(tart.sha)
  assertEquals(await held(tart), [])
})

test('an upload is served by its own app while a row names its bytes', async () => {
  assertEquals(await served(bread), bread.sha)
})
test('another app cannot serve this app’s upload representation', async () => {
  assertEquals(await served(bread, { ...app, eid: 'elsewhere' }), null)
})
test('a deleted upload’s retained representation serves no bytes', async () => {
  assertEquals(await served(bun), null)
})

let returned = await ada.upload('the returned bun')
await kernel.apply([{ entity: { eid: returned.sha }, $delete: true }], {
  trusted: true,
})
await returned.again()
test('the same bytes sent again are served again', async () => {
  assertEquals(await served(returned), returned.sha)
})

// The serving door reads a stable snapshot, independent of the guard's writes.
serveRows = rows.read('.entity')
for (let upload of [bread, bun, returned]) {
  let q = `.entity.eid=${upload.eid} .representation|${naming(upload.sha)}`
  serving.set(q, matcher(q, vocab))
}
