// The blob store end to end against disposable databases (T-18875): the SHA is
// one content entity, attachments point to it, and image dimensions belong to
// the shared content. No test opens the owner's graph.
import { assert, assertEquals, assertThrows } from '@std/assert'
import { DatabaseSync } from 'node:sqlite'
import { sha as hash } from './sha.ts'

Deno.env.set('DB_PATH', ':memory:')
Deno.env.set('HOME', await Deno.makeTempDir())
let { imageSize, landBlob, serveBlob } = await import('./blob.ts')
let { apply, snapshot } = await import('./db.ts')
let { open } = await import('./store/sqlite.ts')
let { db } = await import('./live_db.ts')

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

Deno.test('landBlob makes one content entity and one attachment', async () => {
  let eid = crypto.randomUUID()
  let bytes = png(120, 80)
  let changes = await landBlob(eid, 'shot.png', 'image/png', bytes)
  apply(db, changes)

  let sha = changes[0].eid
  assertEquals(changes, [
    { eid: sha, name: 'blob', comp: { bytes: bytes.length } },
    { eid: sha, name: 'image', comp: { w: 120, h: 80 } },
    {
      eid,
      name: 'attachment',
      comp: { blob: sha, mime: 'image/png', name: 'shot.png' },
    },
  ])

  // Content is shared while attachment metadata belongs to the use.
  let row = db.prepare(
    `select a.mime, ce.eid as blob, b.bytes, i.w from attachment a
     join entity ce on ce.id = a.blob
     join blob b on b.entity = ce.id
     join image i on i.entity = ce.id
     where a.entity = (select id from entity where eid = ?)`,
  ).get(eid)
  assertEquals(row, {
    mime: 'image/png',
    blob: sha,
    bytes: bytes.length,
    w: 120,
  })

  // the bytes live at ~/.tasks/blobs/<sha>, NOT in the row
  assertEquals(await Deno.readFile(`${blobsDir}/${sha}`), bytes)
})

Deno.test('identical bytes dedup to one file; serveBlob returns them', async () => {
  let a = crypto.randomUUID()
  let b = crypto.randomUUID()
  let bytes = png(10, 10)
  apply(db, await landBlob(a, 'a.png', 'image/png', bytes))
  let second = await landBlob(b, 'b.png', 'image/png', bytes)
  apply(db, second)
  let sha = second[0].eid

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

Deno.test('blob identity must be its content hash', () => {
  assertThrows(
    () =>
      apply(db, [{
        eid: crypto.randomUUID(),
        name: 'blob',
        comp: { bytes: 3 },
      }]),
    Error,
    'SHA-256',
  )
})

Deno.test('doc bodies deduplicate behind their wire projection', () => {
  let a = crypto.randomUUID(), b = crypto.randomUUID()
  let body = `shared body ${crypto.randomUUID()}`
  let content = hash(body)
  apply(db, [
    { eid: a, name: 'doc', comp: { title: 'one', body } },
    { eid: b, name: 'doc', comp: { title: 'two', body } },
  ])

  let rows = db.prepare(
    `select e.eid, d.body as ref, v.body
     from doc d join doc_value v on v.entity = d.entity
     join entity e on e.id = d.entity
     where e.eid in (?, ?) order by e.eid`,
  ).all(a, b) as { eid: string; ref: number; body: string }[]
  assertEquals(rows.map((r) => r.body), [body, body])
  assertEquals(rows[0].ref, rows[1].ref)
  assertEquals(
    db.prepare(
      `select b.bytes, t.value, e.num from blob b
       join blob_text t on t.entity = b.entity
       join entity e on e.id = b.entity where e.eid = ?`,
    ).get(content),
    {
      bytes: new TextEncoder().encode(body).byteLength,
      value: body,
      num: null,
    },
  )
  let docs = snapshot(db).changes.filter((c) =>
    c.name == 'doc' && (c.eid == a || c.eid == b)
  )
  assertEquals(docs.map((c) => c.comp?.body), [body, body])
})

Deno.test('legacy inline doc bodies migrate atomically to shared content', async () => {
  let path = await Deno.makeTempFile({ suffix: '.db' })
  let raw = new DatabaseSync(path)
  let a = crypto.randomUUID(), b = crypto.randomUUID()
  raw.exec(`
    create table entity (
      id integer primary key, eid text unique not null, num integer unique
    );
    create table doc (
      entity integer primary key references entity(id),
      title text not null, body text not null default ''
    );
    insert into entity (id, eid, num)
      values (1, '${a}', 1), (2, '${b}', 2);
    insert into doc (entity, title, body)
      values (1, 'one', 'shared body'), (2, 'two', 'shared body');
  `)
  raw.close()

  let migrated = open(path)
  try {
    assertEquals(
      migrated.prepare(
        `select lower(type) type from pragma_table_info('doc')
         where name = 'body'`,
      ).get(),
      { type: 'integer' },
    )
    assertEquals(
      migrated.prepare(
        `select count(distinct d.body) n from doc d join entity e on e.id = d.entity
         where e.eid in (?, ?)`,
      ).get(a, b),
      { n: 1 },
    )
    assertEquals(
      migrated.prepare(
        `select d.title, d.body from doc_value d join entity e on e.id = d.entity
         where e.eid in (?, ?) order by d.title`,
      ).all(a, b),
      [{ title: 'one', body: 'shared body' }, {
        title: 'two',
        body: 'shared body',
      }],
    )
    assertEquals(
      migrated.prepare(
        `select e.eid, e.num from blob b join entity e on e.id = b.entity
         where e.eid = ?`,
      ).all(hash('shared body')),
      [{ eid: hash('shared body'), num: null }],
    )
    assertEquals(migrated.prepare('pragma foreign_key_check').all(), [])
  } finally {
    migrated.close()
    await Deno.remove(path)
  }
})

Deno.test('legacy attachment rows migrate to shared blob entities', async () => {
  let path = await Deno.makeTempFile({ suffix: '.db' })
  let raw = new DatabaseSync(path)
  let a = crypto.randomUUID(), b = crypto.randomUUID()
  let sha = 'ab'.repeat(32)
  raw.exec(`
    create table entity (
      id integer primary key, eid text unique not null, num integer unique
    );
    create table blob (
      entity integer primary key references entity(id), mime text, name text,
      sha text, bytes integer, w integer, h integer
    );
    create index blob_sha on blob(sha);
    insert into entity (id, eid, num) values (1, '${a}', 1), (2, '${b}', 2);
    insert into blob values
      (1, 'image/png', 'a.png', '${sha}', 24, 10, 20),
      (2, 'image/png', 'b.png', '${sha}', 24, 10, 20);
  `)
  raw.close()
  let migrated = open(path)
  try {
    assertEquals(
      migrated.prepare(
        'select count(*) n from blob join entity e on e.id = blob.entity where e.eid = ?',
      ).get(sha),
      { n: 1 },
    )
    assertEquals(
      migrated.prepare('select count(*) n from attachment').get(),
      { n: 2 },
    )
    assertEquals(
      migrated.prepare('select count(*) n from image').get(),
      { n: 1 },
    )
    let changes = snapshot(migrated).changes
    let attachments = changes.filter((c) => c.name == 'attachment')
    assertEquals(attachments.map((c) => c.comp?.blob), [sha, sha])
    assertEquals(
      migrated.prepare('pragma foreign_key_check').all(),
      [],
    )
  } finally {
    migrated.close()
    await Deno.remove(path)
  }
})

Deno.test('legacy attachment migration refuses missing content identity', async () => {
  let path = await Deno.makeTempFile({ suffix: '.db' })
  let raw = new DatabaseSync(path)
  raw.exec(`
    create table entity (
      id integer primary key, eid text unique not null, num integer unique
    );
    create table blob (
      entity integer primary key references entity(id), mime text, name text,
      sha text, bytes integer, w integer, h integer
    );
    insert into entity (id, eid, num)
      values (1, '${crypto.randomUUID()}', 1);
    insert into blob values (1, 'text/plain', 'lost.txt', null, 4, null, null);
  `)
  raw.close()
  assertThrows(() => open(path), Error, 'without SHA-256 content identity')
  let unchanged = new DatabaseSync(path)
  try {
    assertEquals(unchanged.prepare('select count(*) n from blob').get(), {
      n: 1,
    })
    assertEquals(
      unchanged.prepare(
        `select count(*) n from pragma_table_info('blob') where name = 'sha'`,
      ).get(),
      { n: 1 },
    )
  } finally {
    unchanged.close()
    await Deno.remove(path)
  }
})

Deno.test('serveBlob refuses a non-sha path and 404s a missing blob', async () => {
  assertEquals((await serveBlob('../etc/passwd')).status, 400)
  assertEquals((await serveBlob('a'.repeat(64))).status, 404)
})
