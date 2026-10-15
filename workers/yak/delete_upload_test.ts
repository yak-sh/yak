// Deleting an upload: the row at the upload's eid goes, and the bytes leave the
// app's bucket with it (facets/app-effects.ts `delete_upload`), unless a row
// the app keeps still names them. Who may delete that row is the app's write
// guard (graph.ts `appGuard`), whether bytes are still served is `servable`,
// and whether they leave the bucket is `released`: each read here over a graph
// in memory holding the rows an upload writes (apps.ts `filed`).
import { test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import { type Bundle, graph, signed } from '@yaks/graph'
import { Denied } from '@yaks/member'
import { ram } from '@yaks/ram'
import { filed } from './apps.ts'
import { blobPrefix, released, servable } from './blob-key.ts'
import type { App, Space } from './directory.ts'
import type { Env } from './env.ts'
import { appGuard } from './graph.ts'
import type { Meta } from './meta.ts'
import { bucket } from './testing.ts'
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

// An open cookbook, its store guarded as the platform guards it: Ada owns it,
// and a stranger holds no level on it, so the app's mode lets them in. A
// person's write goes through the guard; the kernel's (an upload's rows, signed
// as the uploader, apps.ts `took`) stands outside it, over the same rows.
let ADA = 'a0000000-0000-4000-8000-0000000000a0'
let STRANGER = 'b0000000-0000-4000-8000-0000000000b0'
let space = { slug: 'ada' } as Space
let app = {
  eid: 'c0000000-0000-4000-8000-0000000000c0',
  slug: 'cookbook',
} as App
let rows = ram(vocab)
let kernel = graph({ vocab, storage: rows })
let cookbook = graph({
  vocab,
  storage: rows,
  plugins: [
    appGuard(app.eid, vocab, {}, {
      level: (who) => who == ADA ? 'owner' : null,
    }),
  ],
})
await kernel.apply([{ entity: { eid: app.eid }, access: { mode: 'open' } }], {
  trusted: true,
})
let env = { BLOBS: bucket().r2 } as unknown as Env
let read = async (q: string) => await cookbook.read(q)
let meta = { query: read } as unknown as Meta
let as = (who: string) => ({
  upload: async (text: string) => {
    let file = await filed(
      env,
      space,
      app,
      meta,
      new TextEncoder().encode(text),
      'text/plain',
      '',
    )
    let wrote = () =>
      kernel.apply(signed(file.bundles, { by: who }), { trusted: true })
    await wrote()
    // The same bytes sent again write the same rows.
    return { sha: file.sha, eid: file.url.split('/').pop()!, again: wrote }
  },
  drop: async (eid: string) =>
    await cookbook.apply(
      signed([{ entity: { eid }, $delete: true } as Bundle], {
        by: who,
      }),
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
let held = async (...uploads: { sha: string }[]) =>
  (await read(`.entity.eid=${uploads.map((u) => u.sha).join(',')} .blob`))
    .map((b) => b.entity.eid)
let served = async (upload: { sha: string; eid: string }, of = app) =>
  (await servable(read, of, upload.sha, upload.eid))?.address ?? null

test('a stranger deletes only the uploads they made', async () => {
  await assertRejects(() => stranger.drop(cake.sha), Denied)
  await stranger.drop(pie.sha)
  assertEquals(await held(cake, pie), [cake.sha])
})

test("an app's owner deletes anyone's upload", async () => {
  await ada.drop(tart.sha)
  assertEquals(await held(tart), [])
})

test('an upload is served by its own app while a row names its bytes', async () => {
  assertEquals(await served(bread), bread.sha)
  // Another app's representation of the same bytes is not this app's.
  assertEquals(await served(bread, { ...app, eid: 'elsewhere' }), null)
  // Once the upload is deleted, its representation stays and serves nothing,
  // whatever copy of the bytes is left in a cache or in the bucket.
  await kernel.apply([{ entity: { eid: bread.sha }, $delete: true }], {
    trusted: true,
  })
  assertEquals(await served(bread), null)
})

test('the same bytes sent again are served again', async () => {
  assertEquals(await served(bun), null)
  await bun.again()
  assertEquals(await served(bun), bun.sha)
})
