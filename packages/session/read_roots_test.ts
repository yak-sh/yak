// Transcript bookkeeping must not load session-derived history or old prose.
import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import type { Graph } from '@yaks/graph'
import { locked, seed, store } from './testing.ts'
import { appendEntry } from './append.ts'
import { transcript } from './react.ts'
import { transcriptSegments } from './window.ts'

test('append and fork-window roots read positions, not session status or prose', async () => {
  let s = store()
  seed(s, { entity: { eid: 'parent' }, session: {} }, {
    entity: { eid: 'a' },
    entry: { session: 'parent', seq: 1 },
    content: { body: 'older' },
  }, {
    entity: { eid: 'b' },
    entry: { session: 'parent', seq: 2 },
    content: { body: 'anchor' },
  }, { entity: { eid: 'child' }, session: {}, fork: { from: 'b' } })
  let reads: string[] = []
  let original = s.tx.bind(s)
  s.tx = (fn) =>
    original((tx) =>
      fn({
        ...tx,
        get: (ids, comps) => {
          if (
            (ids.includes('parent') || ids.includes('child')) &&
            comps?.includes('fork')
          ) {
            assert(
              !comps.includes('session'),
              'whole session loads derived history',
            )
          }
          return tx.get(ids, comps)
        },
        read: (q) => {
          reads.push(String(typeof q == 'string' ? q : JSON.stringify(q)))
          return tx.read(q)
        },
      })
    )
  let base = locked(s)
  let g: Graph = {
    ...base,
    get: (ids, comps) => {
      if (ids.includes('parent') || ids.includes('child')) {
        assert(
          comps && !comps.includes('session'),
          'whole session loads derived history',
        )
      }
      return base.get(ids, comps)
    },
  }
  await appendEntry(g, 'child', 'new', { eid: 'c' })
  assertEquals(await transcriptSegments(g, 'child'), [
    { session: 'parent', through: 2 },
    { session: 'child', through: Infinity },
  ])
  // Normal transcript reads still return exact inherited prose.
  assertEquals((await transcript(g, 'child')).map((b) => b.content), [
    { body: 'older' },
    { body: 'anchor' },
    { body: 'new' },
  ])
  assert(reads.length > 0)
})
