// The blob store end to end against an in-memory db (T-12781): landBlob
// content-addresses the bytes beside the db and returns the `blob` metadata to
// ride apply(); serveBlob reads mime off the row and bytes off disk; a second
// attach of identical bytes reuses the one file (dedup); imageSize reads a
// header without a decoder.
import { assert, assertEquals } from '@std/assert'

Deno.env.set('DB_PATH', ':memory:')
Deno.env.set('HOME', await Deno.makeTempDir())
let { imageSize, landBlob, serveBlob } = await import('./blob.ts')
let { apply, db } = await import('./db.ts')

// A minimal PNG: 8-byte signature, IHDR length+tag, then width/height as
// big-endian u32 at offsets 16 and 20 — all imageSize reads.
let png = (w: number, h: number) => {
  let b = new Uint8Array(24)
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  b.set([0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52], 8)
  new DataView(b.buffer).setUint32(16, w)
  new DataView(b.buffer).setUint32(20, h)
  return b
}

let blobsDir = `${Deno.env.get('HOME')}/.tasks/blobs`

Deno.test('imageSize reads PNG, GIF and JPEG headers', () => {
  assertEquals(imageSize(png(120, 80)), { w: 120, h: 80 })
  // GIF87a, 4x2: width/height little-endian u16 at 6/8.
  let gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x37, 0x61, 4, 0, 2, 0])
  assertEquals(imageSize(gif), { w: 4, h: 2 })
  // JPEG: FFD8, one APP0 segment, then an SOF0 whose payload holds h then w.
  let jpg = new Uint8Array([
    0xff,
    0xd8, // SOI
    0xff,
    0xe0,
    0,
    4,
    0,
    0, // APP0, length 4
    0xff,
    0xc0,
    0,
    0x11,
    8,
    0,
    9,
    0,
    16, // SOF0: h=9, w=16
  ])
  assertEquals(imageSize(jpg), { w: 16, h: 9 })
  assertEquals(imageSize(new Uint8Array([1, 2, 3])), null)
})

Deno.test('landBlob stores content-addressed bytes and returns blob metadata', async () => {
  let eid = crypto.randomUUID()
  let bytes = png(120, 80)
  let changes = await landBlob(eid, 'shot.png', 'image/png', bytes)
  apply(db, changes)

  let c = changes[0]
  assertEquals(c.name, 'blob')
  assertEquals(c.comp?.mime, 'image/png')
  assertEquals(c.comp?.name, 'shot.png')
  assertEquals(c.comp?.bytes, bytes.length)
  assertEquals(c.comp?.w, 120)
  assertEquals(c.comp?.h, 80)

  // the metadata landed in the graph, queryable like anything else
  let row = db.prepare(
    'select mime, sha, w from blob where entity = (select id from entity where eid = ?)',
  ).get(eid)
  assertEquals((row as { mime: string }).mime, 'image/png')

  // the bytes live at ~/.tasks/blobs/<sha>, NOT in the row
  let sha = c.comp!.sha as string
  assertEquals(await Deno.readFile(`${blobsDir}/${sha}`), bytes)
})

Deno.test('identical bytes dedup to one file; serveBlob returns them', async () => {
  let a = crypto.randomUUID()
  let b = crypto.randomUUID()
  let bytes = png(10, 10)
  apply(db, await landBlob(a, 'a.png', 'image/png', bytes))
  let second = await landBlob(b, 'b.png', 'image/png', bytes)
  apply(db, second)
  let sha = second[0].comp!.sha as string

  // same content address, so the store holds exactly one file for both
  let files = [...Deno.readDirSync(blobsDir)].filter((f) => f.name == sha)
  assertEquals(files.length, 1)

  let res = await serveBlob(sha)
  assertEquals(res.status, 200)
  assertEquals(res.headers.get('content-type'), 'image/png')
  assert(res.headers.get('content-security-policy')?.includes('sandbox'))
  assertEquals(res.headers.get('x-content-type-options'), 'nosniff')
  assertEquals(new Uint8Array(await res.arrayBuffer()), bytes)
})

Deno.test('serveBlob refuses a non-sha path and 404s a missing blob', async () => {
  assertEquals((await serveBlob('../etc/passwd')).status, 400)
  assertEquals((await serveBlob('a'.repeat(64))).status, 404)
})
