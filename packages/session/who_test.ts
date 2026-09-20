// One word, one meaning: the ways a caller can say which run it means, and
// the actor that run writes as.

import { assertEquals } from '@std/assert'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { idKeywords } from '@yaks/id'
import { ids } from '@yaks/kernel'
import { loadVocab, type VocabDoc } from '@yaks/vocab'
import { sessionDoc } from './comp.ts'
import { sessionFor, speaking, where } from './who.ts'

let spine: VocabDoc = {
  $defs: {
    entity: {
      component: true,
      type: 'object',
      wire: false,
      properties: { num: { type: 'number', stamped: true } },
    },
  },
}

let vocab = loadVocab([sessionDoc, spine], [idKeywords])

// Two runs: one the graph numbered (so a person can say `S-1`), one a harness
// named and nothing else knows about.
let store = () => {
  let s = ram(vocab)
  let g = graph({ storage: s, vocab, plugins: [ids(vocab)] })
  g.apply([
    { entity: { eid: 's1' }, session: { id: 'abc', actor: 'p1' } },
    { entity: { eid: 's2' }, session: { id: 'def' } },
  ], { trusted: true })
  return graph({ storage: s, vocab, plugins: [ids(vocab)] })
}

let found = async (said: string) =>
  (await sessionFor(where(store()), said))?.entity.eid

Deno.test('a run is reached by its eid, its human id, or its own name', async () => {
  assertEquals(await found('s1'), 's1')
  assertEquals(await found('S-1'), 's1')
  assertEquals(await found('abc'), 's1')
  assertEquals(await found('def'), 's2')
})

Deno.test('a word no run answers to reaches nothing', async () => {
  assertEquals(await found('S-404'), undefined)
  assertEquals(await found(''), undefined)
})

Deno.test('a run writes for whoever it speaks as, through itself', () => {
  assertEquals(
    speaking({ entity: { eid: 's1' }, session: { id: 'abc', actor: 'p1' } }),
    { by: 'p1', via: 's1' },
  )
  // Speaking for nobody, it speaks for itself — the run is still the answer
  // to "through what".
  assertEquals(
    speaking({ entity: { eid: 's2' }, session: { id: 'def' } }),
    { by: 's2', via: 's2' },
  )
})
