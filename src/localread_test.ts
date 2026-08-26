// The local-read arm's two pure seams (T-22497): armPath — where the arm may
// read, decided by the caller's own naming — and guarded — local answers, the
// wire covers a local failure and disarms, and the LOCAL error surfaces when
// both fail (a dead server must not turn a filter typo into a connection
// error). The read-only end-to-end (a real file, no server) lives in the slow
// tier below, beside the proof that the armed CLI needs no listener at all.
import { assert, assertEquals, assertRejects } from '@std/assert'
import { armLocal, armPath, disarm, guarded } from './localread.ts'
import { arm } from './client.ts'
import { slow } from './testing.ts'

Deno.test('armPath: explicit DB_PATH names the file — local, host or not', () => {
  let live = '/live'
  assertEquals(
    armPath({ dbPath: '/tmp/x.db', hostSet: true, live }),
    '/tmp/x.db',
  )
  assertEquals(armPath({ dbPath: '/tmp/x.db', live }), '/tmp/x.db')
})

Deno.test('armPath: a host with no file stays on the wire', () => {
  assertEquals(armPath({ hostSet: true, live: '/live' }), undefined)
})

Deno.test('armPath: neither set is the live pairing', () => {
  assertEquals(armPath({ live: '/live' }), '/live')
})

Deno.test('armPath: :memory: never arms — a private db is not the server graph', () => {
  assertEquals(armPath({ dbPath: ':memory:', live: '/live' }), undefined)
  assertEquals(
    armPath({ dbPath: ':memory:', hostSet: true, live: '/live' }),
    undefined,
  )
})

Deno.test('armPath: TASKS_LOCAL=0 turns the arm off outright', () => {
  assertEquals(
    armPath({ dbPath: '/tmp/x.db', disabled: true, live: '/live' }),
    undefined,
  )
  assertEquals(armPath({ disabled: true, live: '/live' }), undefined)
})

Deno.test('guarded: local answers and the wire is never asked', async () => {
  let asked = 0
  let g = guarded((n: number) => n * 2, (): Promise<number> => {
    asked++
    return Promise.resolve(0)
  })
  assertEquals(await g(21), 42)
  assertEquals(asked, 0)
})

Deno.test('guarded: a local failure is answered by the wire and disarms', async () => {
  arm.query = () => Promise.resolve([])
  let g = guarded((): number => {
    throw new Error('no such column: skew')
  }, () => Promise.resolve(7))
  assertEquals(await g(), 7)
  assertEquals(arm.query, undefined)
})

Deno.test('guarded: both failing surfaces the LOCAL error', async () => {
  let g = guarded((): number => {
    throw new Error('not a filter: .typo')
  }, (): Promise<number> => Promise.reject(new Error('ECONNREFUSED')))
  await assertRejects(() => g(), Error, 'not a filter')
})

Deno.test('armLocal: an unopenable path leaves the process wire-only', () => {
  disarm()
  assert(!armLocal('/nonexistent/nowhere/tasks.db'))
  assertEquals(arm.query, undefined)
})

// A real file, opened read-only, answering the armed doors with no server
// anywhere: the win T-22497 exists for. The file is minted by open() (schema +
// seed — the heavy part), then read back through armLocal + client.query.
slow(
  'armLocal: a file answers query/search read-only with no server',
  async () => {
    let dir = await Deno.makeTempDir()
    let path = `${dir}/graph.db`
    let { open } = await import('./db.ts')
    let { query, search } = await import('./client.ts')
    let db = open(path)
    db.prepare('insert into entity (eid, num) values (?, ?)').run('e-lr', 9001)
    db.prepare(
      `insert into doc (entity, title)
       values ((select id from entity where eid = ?), ?)`,
    ).run('e-lr', 'localread proof')
    db.close()
    Deno.env.set('TASKS_HOST', '127.0.0.1:1') // nothing listens — the proof
    try {
      assert(armLocal(path))
      let hits = await query(['.title~=localread'])
      assertEquals(hits.length, 1)
      assertEquals(hits[0].comps.doc?.title, 'localread proof')
      let found = await search('localread')
      assert(found.some((h) => h.eid == 'e-lr'))
    } finally {
      Deno.env.delete('TASKS_HOST')
      disarm()
      await Deno.remove(dir, { recursive: true })
    }
  },
)
