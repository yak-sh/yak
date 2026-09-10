import { assert, assertEquals } from '@std/assert'
import type { Comp } from '@yaks/graph'
import type { Model } from '@yaks/model'
import { react, statusOf, transcript } from '@yaks/session'
import { open } from './store.ts'

let fake: Model = (req) =>
  Promise.resolve({
    id: 'r1',
    model: req.model,
    items: [{ kind: 'assistant', text: 'pong' }],
  })

let seeded = () => {
  let h = open(':memory:')
  h.g.apply([
    { entity: { eid: 'p' }, provider: { name: 'openai' } },
    { entity: { eid: 'm' }, model: { name: 'gpt-6-astra', provider: 'p' } },
    { entity: { eid: 's' }, session: { id: 'one' } },
    {
      entity: { eid: 'in1' },
      entry: { session: 's', seq: 1 },
      content: { body: 'ping' },
      using: { provider: 'p', model: 'm' },
    },
  ])
  return h
}

Deno.test('a transcript is entities in SQLite, read back in order', async () => {
  let h = seeded()
  let entries = await transcript(h.g, 's')
  assertEquals(entries.map((b) => (b.content as Comp).body), ['ping'])
  assertEquals(statusOf(entries), 'pending')
  h.close()
})

Deno.test('one step against a fake model appends its ask and its prose', async () => {
  let h = seeded()
  let step = await react(h.g, 's', { model: fake, tools: [] })
  assertEquals(step.did, 'asked')
  assertEquals(step.status, 'settled')
  let entries = await transcript(h.g, 's')
  assertEquals(entries.map((b) => (b.content as Comp)?.body), [
    'ping',
    undefined,
    'pong',
  ])
  h.close()
})

Deno.test('session.status is a derived column, so a query filters on it', async () => {
  let h = seeded()
  assertEquals((await h.g.read('.session.status=pending')).length, 1)
  assertEquals((await h.g.read('.session.status=settled')).length, 0)
  await react(h.g, 's', { model: fake, tools: [] })
  assertEquals(
    (await h.g.read('.session.status=settled')).map((b) => b.entity.eid),
    ['s'],
  )
  h.close()
})

Deno.test('a task applies and reads back with its derived status', async () => {
  let h = open(':memory:')
  h.g.apply([{
    entity: { eid: 't1' },
    doc: { title: 'reply with pong' },
    task: {},
    filed: { priority: 2 },
  }])
  let [t] = await h.g.read('.task.status=open')
  assertEquals((t.doc as Comp).title, 'reply with pong')
  h.g.apply([{ entity: { eid: 't1' }, completed: {} }])
  assertEquals((await h.g.read('.task.status=open')).length, 0)
  assert((await h.g.read('.task.status=done')).length == 1)
  h.close()
})

Deno.test('a stale lease is freed at boot', async () => {
  let path = `${Deno.makeTempDirSync()}/h.db`
  let one = open(path)
  one.g.apply([
    { entity: { eid: 's' }, session: { id: 'one' } },
    {
      entity: { eid: 'p1' },
      doc: { title: 'a page' },
      claim: { session: 's' },
    },
  ])
  // The holder never made it to the graph the next boot reads: delete it the
  // way an abnormal ending would have, leaving the lock behind.
  one.db.exec('delete from "session"')
  one.close()
  let two = open(path)
  let [page] = await two.g.read('.doc')
  assertEquals(page.claim, undefined)
  two.close()
})

Deno.test('a file-backed harness uses WAL with NORMAL sync and a busy timeout', () => {
  let dir = Deno.makeTempDirSync()
  try {
    let h = open(`${dir}/h.db`)
    try {
      assertEquals(h.db.prepare('pragma journal_mode').get(), {
        journal_mode: 'wal',
      })
      assertEquals(h.db.prepare('pragma synchronous').get(), { synchronous: 1 })
      assertEquals(h.db.prepare('pragma busy_timeout').get(), { timeout: 5000 })
    } finally {
      h.close()
    }
  } finally {
    Deno.removeSync(dir, { recursive: true })
  }
})

Deno.test('entries omit human numbers, including migrated entries after reopen', async () => {
  let dir = Deno.makeTempDirSync()
  let path = dir + '/numbering.db'
  try {
    let h = open(path)
    await h.g.apply([
      { entity: { eid: 's' }, session: {} },
      {
        entity: { eid: 'e' },
        entry: { session: 's', seq: 1 },
        content: { body: 'hello' },
      },
    ])
    assertEquals((await h.g.read('.entry'))[0].entity.num, undefined)
    // Simulate a legacy entry number; this is an isolated test database.
    h.db.exec("update entity set num = 99999 where eid = 'e'")
    h.close()
    h = open(path)
    assertEquals((await h.g.read('.entry'))[0].entity.num, undefined)
    await h.g.apply([{ entity: { eid: 't' }, task: {} }])
    assertEquals((await h.g.read('.task'))[0].entity.num, undefined)
    assertEquals((await h.g.read('.session'))[0].entity.num, undefined)
    h.close()
  } finally {
    Deno.removeSync(dir, { recursive: true })
  }
})

Deno.test('legacy completion actors become authors once, including anonymous marks', () => {
  let dir = Deno.makeTempDirSync()
  let path = dir + '/legacy.db'
  let h = open(path)
  try {
    h.g.apply([
      { entity: { eid: 'parent' }, session: {} },
      { entity: { eid: 'worker' }, session: {} },
      { entity: { eid: 'known' }, task: {}, completed: { by: 'worker' } },
      { entity: { eid: 'anonymous' }, task: {}, completed: { by: 'worker' } },
    ])
    h.db.exec('alter table completed add column actor integer')
    h.db.exec('create index completed_actor on completed(actor)')
    h.db.exec(
      `update completed set actor = (select id from entity where eid = 'parent')
      where entity = (select id from entity where eid = 'known')`,
    )
    h.close()
    h = open(path)
    let authors = () =>
      h.store.read('.task').map((b) => [
        b.entity.eid,
        (b.completed as Comp).by ?? null,
      ]).sort()
    assertEquals(authors(), [['anonymous', null], ['known', 'parent']])
    assert(
      !h.db.prepare('pragma table_info(completed)').all<{ name: string }>()
        .some((c) => c.name == 'actor'),
    )
    // An edit after migration must survive the next open: no stale actor copy.
    h.db.exec(
      `update completed set "by" = (select id from entity where eid = 'worker')
      where entity = (select id from entity where eid = 'known')`,
    )
    h.close()
    h = open(path)
    assertEquals(authors(), [['anonymous', null], ['known', 'worker']])
  } finally {
    h.close()
    Deno.removeSync(dir, { recursive: true })
  }
})

Deno.test('harness tasks and sessions stay num-less; existing human numbers survive', async () => {
  let dir = Deno.makeTempDirSync()
  let h = open(dir + '/numbers.db')
  try {
    await h.g.apply([
      { entity: { eid: 'old' }, task: {} },
      { entity: { eid: 'parent' }, session: {} },
      { entity: { eid: 'micro' }, task: {}, doc: { title: 'TUI task' } },
      { entity: { eid: 'child' }, session: {}, spawned: { parent: 'parent' } },
    ])
    assertEquals(
      (await h.g.read('.task')).every((b) => b.entity.num == null),
      true,
    )
    assertEquals((await h.g.read('.session'))[0].entity.num, undefined)
    h.db.exec("update entity set num = 42 where eid = 'old'")
    h.close()
    h = open(dir + '/numbers.db')
    assertEquals((await h.g.read('.entity.num=42'))[0].entity.eid, 'old')
  } finally {
    h.close()
    Deno.removeSync(dir, { recursive: true })
  }
})

Deno.test('startup repairs fractional positions once without moving fork anchors', async () => {
  let dir = await Deno.makeTempDir()
  let path = dir + '/sequences.db'
  let h = open(path)
  try {
    await h.g.apply([
      { entity: { eid: 's' }, session: {} },
      { entity: { eid: 'a' }, entry: { session: 's', seq: 1 } },
      { entity: { eid: 'b' }, entry: { session: 's', seq: 2 } },
      { entity: { eid: 'f' }, session: {}, fork: { from: 'b' } },
      { entity: { eid: 'c' }, entry: { session: 'f', seq: 3 } },
    ])
    h.db.exec('update entry set seq=seq-0.125 where seq > 1')
    h.db.exec("delete from harness_upgrade where name='entry-seq-v1'")
    h.close()
    h = open(path)
    let rows = await transcript(h.g, 'f')
    assertEquals(rows.map((b) => b.entity.eid), ['a', 'b', 'c'])
    assertEquals(rows.map((b) => (b.entry as Comp).seq), [1, 2, 3])
    h.close()
    h = open(path)
    assertEquals(
      (await transcript(h.g, 'f')).map((b) => (b.entry as Comp).seq),
      [1, 2, 3],
    )
  } finally {
    h.close()
    await Deno.remove(dir, { recursive: true })
  }
})

Deno.test('SQLite commits simultaneous append batches with distinct positions', async () => {
  let h = open(':memory:')
  try {
    await h.g.apply([{ entity: { eid: 's' }, session: {} }])
    await Promise.all(
      Array.from({ length: 30 }, (_, i) =>
        h.g.apply([{
          entity: { eid: 'append' + i },
          entry: { session: 's' },
          notice: {},
          content: { body: 'context' },
        }])),
    )
    assertEquals(
      (await transcript(h.g, 's')).map((b) => (b.entry as Comp).seq),
      Array.from({ length: 30 }, (_, i) => i + 1),
    )
  } finally {
    h.close()
  }
})

Deno.test('boot opens the store even when a transcript cannot be repaired', async () => {
  let dir = Deno.makeTempDirSync()
  let path = dir + '/tangled.db'
  let warned: string[] = [], warn = console.warn
  try {
    let one = open(path)
    one.g.apply([
      { entity: { eid: 'a' }, session: { id: 'a' } },
      { entity: { eid: 'b' }, session: { id: 'b' } },
    ])
    one.g.apply([{ entity: { eid: 'ea' }, entry: { session: 'a' } }])
    one.g.apply([{ entity: { eid: 'eb' }, entry: { session: 'b' } }])
    // A fork ring: each session anchors in the other, so no order exists.
    // Re-arm the upgrade so the next boot meets it.
    one.g.apply([
      { entity: { eid: 'a' }, fork: { from: 'eb' } },
      { entity: { eid: 'b' }, fork: { from: 'ea' } },
    ])
    one.db.exec('delete from harness_upgrade')
    one.close()
    console.warn = (...args) => warned.push(args.join(' '))
    let two = open(path)
    console.warn = warn
    assertEquals(
      (await two.g.read('.session')).map((b) => b.entity.eid).sort(),
      ['a', 'b'],
    )
    two.close()
    assert(warned.some((line) => line.includes('transcript repair skipped')))
  } finally {
    console.warn = warn
    Deno.removeSync(dir, { recursive: true })
  }
})
