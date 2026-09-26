import { assert, assertEquals } from '@std/assert'
import { type Comp, identityEid } from '@yaks/graph'
import type { Model } from '@yaks/model'
import { react, statusOf, transcript } from '@yaks/session'
import { harness } from './testing.ts'

let fake: Model = (req) =>
  Promise.resolve({
    id: 'r1',
    model: req.model,
    items: [{ kind: 'assistant', text: 'pong' }],
  })

let P = identityEid('provider', ['openai'])
let M = identityEid('model', ['gpt-6-astra'])
let A = identityEid('model', ['astra'])

let seeded = async () => {
  let h = await harness()
  h.g.apply([
    { entity: { eid: P }, provider: { name: 'openai' } },
    { entity: { eid: M }, model: { name: 'gpt-6-astra' } },
    { entity: { eid: 's' }, session: { id: 'one' } },
    {
      entity: { eid: 'in1' },
      entry: { session: 's', seq: 1 },
      content: { body: 'ping' },
      using: { provider: P, model: M },
    },
  ])
  return h
}

Deno.test('a transcript is entities in SQLite, read back in order', async () => {
  let h = await seeded()
  let entries = await transcript(h.g, 's')
  assertEquals(entries.map((b) => (b.content as Comp).body), ['ping'])
  assertEquals(statusOf(entries), 'pending')
  h.close()
})

Deno.test('one step against a fake model appends its ask and its prose', async () => {
  let h = await seeded()
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

Deno.test('session.status is a derived property, so a query filters on it', async () => {
  let h = await seeded()
  assertEquals((await h.g.read('.session.status=pending&*')).length, 1)
  assertEquals((await h.g.read('.session.status=settled&*')).length, 0)
  await react(h.g, 's', { model: fake, tools: [] })
  assertEquals(
    (await h.g.read('.session.status=settled&*')).map((b) => b.entity.eid),
    ['s'],
  )
  h.close()
})

Deno.test('a task applies and reads back with its derived status', async () => {
  let h = await harness()
  h.g.apply([{
    entity: { eid: 't1' },
    doc: { title: 'reply with pong' },
    task: {},
    filed: { priority: 2 },
  }])
  let [t] = await h.g.read('.task.status=open&*')
  assertEquals((t.doc as Comp).title, 'reply with pong')
  h.g.apply([{ entity: { eid: 't1' }, completed: {} }])
  assertEquals((await h.g.read('.task.status=open&*')).length, 0)
  assert((await h.g.read('.task.status=done&*')).length == 1)
  h.close()
})

Deno.test('entries, tasks and sessions omit human numbers, after reopen too', async () => {
  let dir = Deno.makeTempDirSync()
  let path = dir + '/numbering.db'
  try {
    let h = await harness(path)
    await h.g.apply([
      { entity: { eid: 's' }, session: {} },
      {
        entity: { eid: 'e' },
        entry: { session: 's', seq: 1 },
        content: { body: 'hello' },
      },
    ])
    assertEquals((await h.g.read('.entry&*'))[0].entity.num, undefined)
    h.close()
    h = await harness(path)
    assertEquals((await h.g.read('.entry&*'))[0].entity.num, undefined)
    await h.g.apply([{ entity: { eid: 't' }, task: {} }])
    assertEquals((await h.g.read('.task&*'))[0].entity.num, undefined)
    assertEquals((await h.g.read('.session&*'))[0].entity.num, undefined)
    h.close()
  } finally {
    Deno.removeSync(dir, { recursive: true })
  }
})

Deno.test('a deleted provider leaves past entries saying what answered', async () => {
  let dir = Deno.makeTempDirSync()
  let h = await harness(dir + '/history.db')
  try {
    h.g.apply([
      { entity: { eid: P }, provider: { name: 'openai' } },
      { entity: { eid: A }, model: { name: 'astra' } },
      { entity: { eid: 's' }, session: {} },
      {
        entity: { eid: 'e' },
        entry: { session: 's' },
        using: { provider: P, model: A },
      },
    ])
    h.g.apply([{ entity: { eid: P }, tombstone: {} }])
    assertEquals(h.store.read('.entry')[0].using, {
      provider: P,
      model: A,
      effort: null,
      instructions: null,
    })
  } finally {
    h.close()
    Deno.removeSync(dir, { recursive: true })
  }
})

Deno.test('SQLite commits simultaneous append batches with distinct positions', async () => {
  let h = await harness()
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
