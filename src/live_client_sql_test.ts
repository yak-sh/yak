// The actual SQLite subscription door through the browser adapter, not a local
// matcher standing in for either end. No server process or network is needed.
import { assertEquals, assertFalse } from '@std/assert'
import { liveClient } from './live_client.ts'
import { predsToQuery, type Sub } from './live.ts'
import { parseQuery } from './query.ts'
import { subserve } from './subserve.ts'
import { applyNumbered, bareDb } from './testdb.ts'
import { link } from './edge.ts'
import { type Change, uuid } from './types.ts'

Deno.test('SQLite FTS, projections, windows, walks, tallies and riders cross the adapter', () => {
  let db = bareDb()
  let a = uuid(), b = uuid(), c = uuid()
  let frames: Sub[] = []
  let client = liveClient({
    send: (sub, q) =>
      server.frame(q === undefined ? { unsub: sub } : { sub, q }),
    changed: () => {},
    ready: () => {},
  })
  let server = subserve(db, (frame) => {
    if (!Array.isArray(frame) && typeof frame.sub === 'string') {
      frames.push(frame as Sub)
      client.receive(frame as Sub)
    }
  })
  let write = (changes: Change[]) => {
    applyNumbered(db, changes)
    server.maintain(changes)
  }
  try {
    write([
      { eid: a, name: 'doc', comp: { title: 'ộ', body: 'complete a' } },
      { eid: a, name: 'task', comp: {} },
      { eid: b, name: 'doc', comp: { title: 'other', body: 'complete b' } },
      { eid: b, name: 'task', comp: {} },
      { eid: c, name: 'comment', comp: { target: a } },
      ...link(a, 'requires', b),
    ])
    let open = (name: string, query: string) => {
      client.open(name, predsToQuery(parseQuery(query))!)
      assertEquals(frames.at(-1)?.error, undefined, query)
      assertEquals(client.ready(name), true, query)
    }
    open('fts', 'o')
    assertEquals(client.members('fts'), []) // FTS5 does not equate this diacritic
    write([{ eid: a, name: 'doc', comp: { title: 'o' } }])
    assertEquals(client.members('fts'), [a])
    write([{ eid: a, name: 'doc', comp: { title: 'ộ' } }])
    assertEquals(client.members('fts'), [])
    open('projection', '.task! .fields=doc.title .limit=1')
    assertEquals(client.members('projection'), [b])
    assertEquals(frames.at(-1)?.window, { limit: 1, total: 2 })
    assertEquals(client.box.cache.loaded(b, 'doc', 'title'), true)
    assertFalse(client.box.cache.loaded(b, 'doc', 'body'))
    open('walk', `.requires->${b}`)
    assertEquals(client.members('walk'), [a])
    open('ref-walk', `.comment.target->${a}`)
    assertEquals(client.members('ref-walk'), [c])
    client.open('rider', `id=${a}&.edges[requires]!&.edges.peers=doc.title`)
    assertEquals(frames.at(-1)?.error, undefined)
    assertEquals(client.members('rider'), [a])
    assertEquals(frames.at(-1)?.edges, [{
      parent: a,
      type: 'requires',
      child: b,
    }])
    assertEquals(client.box.ent(b)?.doc, { title: 'other' })
    write([
      { eid: a, name: 'filed', comp: { priority: 1 } },
      { eid: b, name: 'filed', comp: { priority: 2 } },
      { eid: c, name: 'doc', comp: { title: 'rider' } },
      ...link(a, 'requires', c),
    ])
    open(
      'ranked-window',
      '.task! .order=priority .limit=2 .fields=doc.title .edges[requires]! .edges.peers=doc.title',
    )
    assertEquals(client.members('ranked-window'), [a, b])
    write([{ eid: a, name: 'filed', comp: { priority: 3 } }])
    let reordered = frames.filter((f) => f.sub === 'ranked-window').at(-1)!
    assertEquals(reordered.replace, true)
    assertEquals(client.members('ranked-window'), [b, a])
    assertEquals(client.box.ent(c)?.doc, { title: 'rider' })
    assertEquals(client.box.cache.loaded(c, 'doc', 'title'), true)
    assertEquals(reordered.edges?.some((d) => d.child === c), true)
    assertFalse(client.box.cache.loaded(c, 'doc', 'body'))
    open('tally', '.comment! .tally=comment.target')
    assertEquals(frames.at(-1)?.changes, undefined)
    assertEquals(frames.at(-1)?.agg, { [a]: 1 })
    assertEquals(client.members('tally'), [])
    write([{ eid: c, name: 'comment', comp: { target: b } }])
    let tally = frames.filter((f) => f.sub === 'tally').at(-1)!
    assertEquals(tally.agg, { [a]: 0, [b]: 1 })
    // The synchronous WS door cannot perform embedding I/O. Preserve its
    // addressed refusal, not a locally invented semantic answer. Semantic
    // /query remains the async askRows/ranker door (ranked_read_test.ts).
    client.open('semantic', `.near=${a}&.order=similar`)
    assertEquals(
      frames.at(-1)?.error?.includes('embedding query evaluator'),
      true,
    )
    assertFalse(client.ready('semantic'))
    assertEquals(client.members('semantic'), [])
  } finally {
    client.box.close()
    db.close()
  }
})
