// The upload door end to end against an in-memory db: the author's bytes
// land as-is (scrub is the URL-freeze door's job), land() stamps
// frozen_at — and the stamp must ride the JOURNAL, not just the sockets,
// or a tab booting by catch-up replay shows "freezing …" over an archive
// that exists (T-7437).
import { assert, assertEquals } from '@std/assert'

Deno.env.set('DB_PATH', ':memory:')
Deno.env.set('HOME', await Deno.makeTempDir())
let { freeze, store } = await import('./freeze.ts')
let { apply, delta } = await import('./db.ts')
let { db } = await import('./live_db.ts')

let PAGE = `<html><head><title>Ten dots</title>
  <script src="https://evil.example/x.js"></script>
  <style>body { background: url(https://evil.example/bg.png) }</style>
  </head><body><img src="https://evil.example/i.png"><p>pips</p></body></html>`

let disk = (eid: string) =>
  Deno.readTextFile(`${Deno.env.get('HOME')}/.tasks/frozen/${eid}.html`)

Deno.test('store: lands the bytes, stamps frozen_at, journals the landing', async () => {
  let eid = crypto.randomUUID()
  apply(db, [{ eid, name: 'web', comp: { url: '' } }])
  let before = delta(db, 0).cursor
  let heard: unknown[] = []
  let res = await store(eid, PAGE, (c) => heard.push(...c))
  assertEquals(res.status, 200)
  assertEquals(await disk(eid), PAGE) // a delivered page is the artifact

  // the catch-up door replays the same landing the sockets heard
  let replay = delta(db, before).changes
  assert(
    replay.some((c) => c.eid == eid && c.name == 'web' && c.comp?.frozen_at),
  )
  assertEquals(
    replay.find((c) => c.eid == eid && c.name == 'doc')?.comp?.title,
    'Ten dots', // the page <title>, adopted and journaled with the stamp
  )
  assert(heard.length >= 1) // and the cast went out
})

Deno.test('store: scrubbed leaves nothing external on disk', async () => {
  let eid = crypto.randomUUID()
  apply(db, [{ eid, name: 'web', comp: { url: '' } }])
  await store(eid, PAGE, () => {}, true)
  let html = await disk(eid)
  assert(!html.includes('<script'))
  assert(!html.includes('evil.example'))
})

Deno.test('freeze: failures stamp shared health and successful storage clears it', async () => {
  let eid = crypto.randomUUID()
  apply(db, [{ eid, name: 'web', comp: { url: 'https://bad.example/' } }])
  let before = delta(db, 0).cursor
  let heard: import('./types.ts').Change[] = []
  let res = await freeze(eid, (c) => heard.push(...c), () =>
    Promise.resolve({
      success: false,
      stderr: new TextEncoder().encode('network refused'),
    }))
  assertEquals(res.status, 502)
  assertEquals(
    db.prepare(
      'select message from error where entity = (select id from entity where eid = ?)',
    ).get(eid),
    { message: 'Error: network refused' },
  )
  assert(heard.some((c) => c.eid == eid && c.name == 'error'))
  assert(
    delta(db, before).changes.some((c) => c.eid == eid && c.name == 'error'),
  )

  before = delta(db, 0).cursor
  heard = []
  await store(eid, PAGE, (c) => heard.push(...c))
  assertEquals(
    db.prepare(
      'select 1 from error where entity = (select id from entity where eid = ?)',
    ).get(eid),
    undefined,
  )
  assert(heard.some((c) => c.eid == eid && c.name == 'error' && !c.comp))
  assert(
    delta(db, before).changes.some((c) =>
      c.eid == eid && c.name == 'error' && !c.comp
    ),
  )
})

Deno.test('store: no such web entity refuses without touching disk', async () => {
  let res = await store(crypto.randomUUID(), PAGE, () => {})
  assertEquals(res.status, 404)
})
