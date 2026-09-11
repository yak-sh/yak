import { assertEquals, assertFalse } from '@std/assert'
import { liveClient } from './live_client.ts'
import { spread } from './subs.ts'
import { parseQuery } from './query.ts'
import { predsToQuery } from './live.ts'

let harness = () => {
  let sent: { sub: string; q?: string }[] = []
  let changed: string[][] = []
  let ready: string[] = []
  let c = liveClient({
    send: (sub, q) => sent.push({ sub, q }),
    changed: (eids) => changed.push(eids),
    ready: (sub) => ready.push(sub),
  })
  return { c, sent, changed, ready }
}
let row = (eid: string, title = eid) =>
  spread(eid, {
    entity: { eid, num: 1 },
    doc: { title },
    task: {},
  })

Deno.test('Tasks query serialization preserves search, near, walks, riders and reductions', () => {
  for (
    let q of [
      'running "two words" .doc.title~="quote \\" here"',
      '.near="a semantic question" .order=similar .limit=6 .after=42',
      '.requires[<=3]->abcdef10-0000-4000-8000-000000000001',
      '.comment.target<-abcdef10-0000-4000-8000-000000000001',
      '.task! .edges[referenced,entry.session]! .edges.peers=doc.title .edges.limit=100',
      '.task! .tally=status',
      '.count!',
      '.distinct=domain',
      '.comments!.doc.title~=unread',
      '.comments>=5',
      '.comments=',
      '.filed.priority<=P2 .task! .fields=doc.title,pin.z~',
      '.doc.body= .doc.title! .doc.title!=hidden',
      '?doc .task!',
    ]
  ) {
    let preds = parseQuery(q)
    let serialized = predsToQuery(preds)
    assertEquals(serialized === undefined, false, q)
    assertEquals(parseQuery(serialized!), preds, q)
  }
})

Deno.test('opaque FTS/near/walk membership and order are authoritative, never local matches', () => {
  let { c, sent } = harness()
  try {
    for (
      let q of [
        'running',
        '.near="concept absent from row"',
        '.requires->remote',
      ]
    ) {
      c.open('query', q)
      assertEquals(c.members('query'), [])
      c.receive({
        sub: 'query',
        replace: true,
        changes: [...row('b', 'ran'), ...row('a', 'different')],
      })
      assertEquals(c.members('query'), ['b', 'a'])
      c.patch(row('local', 'running'))
      assertEquals(c.members('query'), ['b', 'a'])
      c.receive({
        sub: 'query',
        replace: true,
        changes: [...row('a'), ...row('b')],
      })
      assertEquals(c.members('query'), ['a', 'b'])
      c.close('query')
    }
    assertEquals(sent.filter((s) => s.q !== undefined).length, 3)
  } finally {
    c.box.close()
  }
})

Deno.test('deduped names share one wire answer; late frames cannot resurrect disposed handles', () => {
  let { c, sent } = harness()
  try {
    c.open('one', '.task!')
    c.open('two', '.task!')
    assertEquals(sent.length, 1)
    c.receive({ sub: 'one', replace: true, changes: row('a') })
    assertEquals(c.ready('one'), true)
    assertEquals(c.ready('two'), true)
    c.close('one')
    assertEquals(sent.length, 1)
    c.receive({ sub: 'one', changes: row('b') })
    assertEquals(c.members('two'), ['a', 'b'])
    c.close('two')
    assertEquals(sent.at(-1), { sub: 'one', q: undefined })
    c.receive({ sub: 'one', changes: row('late') })
    assertEquals(c.box.ent('late'), undefined)
    c.open('three', '.task!')
    assertEquals(c.members('three'), ['a', 'b'])
    assertFalse(c.ready('three'))
    c.receive({ sub: 'three', replace: true, changes: [] })
    assertEquals(c.members('three'), [])
    assertEquals(c.ready('three'), true)
  } finally {
    c.box.close()
  }
})

Deno.test('projection patches preserve declared fields; refusal preserves coverage and retry is addressed', () => {
  let { c, sent } = harness()
  try {
    c.open('projected', '.task! .fields=doc.title,pin.x')
    c.open('other', '.project!')
    c.receive({
      sub: 'projected',
      replace: true,
      fields: [{ comp: 'doc', prop: 'title', wake: true }, {
        comp: 'pin',
        prop: 'x',
        wake: true,
      }],
      changes: [...row('a'), ...spread('a', { pin: { x: 4 } })],
    })
    assertEquals(c.box.cache.loaded('a', 'doc', 'title'), true)
    assertFalse(c.box.cache.loaded('a', 'doc', 'body'))
    c.receive({
      sub: 'projected',
      replace: true,
      changes: [],
      error: 'read refused',
    })
    assertFalse(c.ready('projected'))
    assertEquals(c.members('projected'), ['a'])
    c.retry('projected')
    assertEquals(sent.at(-1)?.sub, 'projected')
    assertEquals(sent.filter((s) => s.sub === 'other').length, 1)
    c.receive({
      sub: 'projected',
      changes: spread('a', { doc: { title: 'changed' } }),
    })
    assertEquals(c.box.ent('a')?.pin, { x: 4 })
    assertFalse(c.box.cache.loaded('a', 'doc', 'body'))
  } finally {
    c.box.close()
  }
})

Deno.test('peer riders never join membership and their delta columns/owners remain independent', () => {
  let { c } = harness()
  try {
    c.open('one', '.task! .edges.peers=doc.title,task.status')
    c.open('two', '.project! .fields=doc.title')
    c.receive({
      sub: 'one',
      replace: true,
      changes: row('a'),
      peers: spread('peer', {
        entity: { eid: 'peer', num: 2 },
        doc: { title: 'peer' },
        task: { status: 'open' },
      }),
    })
    c.receive({
      sub: 'one',
      changes: [],
      peers: spread('peer', { task: { status: 'done' } }),
    })
    assertEquals(c.members('one'), ['a'])
    assertEquals(c.box.ent('peer')?.doc, { title: 'peer' })
    assertEquals(c.box.ent('peer')?.task, { status: 'done' })
    assertFalse(c.box.cache.loaded('peer', 'doc', 'body'))
    c.receive({
      sub: 'two',
      replace: true,
      fields: [{ comp: 'doc', prop: 'title', wake: true }],
      changes: row('peer'),
    })
    c.receive({ sub: 'one', changes: [], unpeers: ['peer'] })
    assertEquals(c.members('two'), ['peer'])
    assertEquals(c.box.ent('peer')?.doc, { title: 'peer' })
    assertFalse(c.box.cache.loaded('peer', 'task', 'status'))
  } finally {
    c.box.close()
  }
})

Deno.test('echoed Tasks patches do not invent provenance or use automatic POST; pending pins reconcile after ack', () => {
  let { c } = harness()
  try {
    c.open('card:a', 'id=a')
    c.receive({ sub: 'card:a', replace: true, changes: row('a', 'before') })
    c.patch(spread('a', { doc: { title: 'optimistic' } }))
    let release = c.box.cache.protect(['a'])
    c.receive({ sub: 'card:a', replace: true, changes: row('a', 'stale') })
    assertEquals(c.box.ent('a')?.doc, { title: 'optimistic' })
    release() // Tasks sends ack before feed.settle() on the same socket.
    c.receive({ sub: 'card:a', changes: row('a', 'canonical') })
    assertEquals(c.box.ent('a')?.doc, { title: 'canonical' })
    assertEquals(c.box.ent('a')?.created, undefined)
    assertEquals(c.box.ent('a')?.updated, undefined)
  } finally {
    c.box.close()
  }
})

Deno.test('disconnect invalidates every read without sending, retaining provisional paint', () => {
  let { c, sent } = harness()
  try {
    c.open('one', '.task!')
    c.receive({ sub: 'one', replace: true, changes: row('a') })
    let n = sent.length
    c.invalidate()
    assertEquals(sent.length, n)
    assertFalse(c.ready('one'))
    assertEquals(c.members('one'), ['a'])
    c.retry('one')
    c.receive({ sub: 'one', replace: true, changes: [] })
    assertEquals(c.members('one'), [])
    assertEquals(c.ready('one'), true)
  } finally {
    c.box.close()
  }
})

Deno.test('synchronous transport replies are owned before send, including empty answers', () => {
  let c = liveClient({
    send: (sub, q) => {
      if (q) c.receive({ sub, replace: true, changes: [] })
    },
    ready: () => {},
    changed: () => {},
  })
  try {
    c.open('one', '.task!')
    assertEquals(c.ready('one'), true)
    assertEquals(c.members('one'), [])
  } finally {
    c.box.close()
  }
})
