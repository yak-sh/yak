import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { type Bundle, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab, type VocabDoc } from '@yaks/vocab'
import { idKeywords } from './keywords.ts'
import { idDoc } from './vocab.ts'
import { held } from './held.ts'

let doc: VocabDoc = {
  $defs: {
    entity: { component: true, type: 'object', wire: false, properties: {} },
    project: { component: true, type: 'object', kind: true, prefix: 'P' },
    task: { component: true, type: 'object', kind: true, prefix: 'T' },
  },
}
let vocab = loadVocab([doc, idDoc], [idKeywords])

test('a store holds its small series and draws each by its id', async () => {
  let g = graph({ storage: ram(vocab, { number: true }), vocab })
  let made = (comp: string, ...eids: string[]) =>
    g.apply(eids.map((eid) => ({ entity: { eid }, [comp]: {} })) as Bundle[])
  made('project', 'p1')
  made('task', 't1', 't2', 't3')
  let t = 0
  let ids = held(vocab, g, { small: 3, fresh: 10, now: () => t })
  // Three tasks are not fewer than three: that series is too big to hold.
  let known = await ids()
  assertEquals(['p1', 't1', 'gone'].map(known), ['P-1', undefined, undefined])
  // What is held is read again once it is older than `fresh`.
  made('project', 'p2')
  assertEquals((await ids())('p2'), undefined)
  t = 10
  assertEquals((await ids())('p2'), 'P-5')
})

// An id is drawn from the kind an entity wears first in kind order: of its
// series' components, or a kind before them with no prefix of its own. What
// comes after its series (here a note's body) is never read.
test('a held entity is drawn by its first kind, and nothing after it is read', async () => {
  let doc: VocabDoc = {
    $defs: {
      entity: { component: true, type: 'object', wire: false, properties: {} },
      app: { component: true, type: 'object', kind: true },
      project: { component: true, type: 'object', kind: true, prefix: 'P' },
      task: { component: true, type: 'object', kind: true, prefix: 'T' },
      zine: {
        component: true,
        type: 'object',
        kind: true,
        properties: { body: { type: 'string' } },
      },
    },
  }
  let vocab = loadVocab([doc, idDoc], [idKeywords])
  let g = graph({ storage: ram(vocab, { number: true }), vocab })
  await g.apply([
    { entity: { eid: 'a' }, app: {}, project: {} },
    { entity: { eid: 'pt' }, project: {}, task: {}, zine: { body: 'long' } },
    { entity: { eid: 't' }, task: {}, zine: { body: 'long' } },
  ] as Bundle[])
  let asked: string[] = []
  let ids = await held(vocab, {
    read: g.read,
    get: ((eids: string[], comps?: string[]) => (
      asked.push(...comps ?? ['all']), g.get(eids, comps)
    )) as typeof g.get,
  })()
  assertEquals(['a', 'pt', 't'].map(ids), ['A-1', 'P-2', 'T-3'])
  assertEquals(asked.some((c) => c == 'zine' || c == 'all'), false)
})
