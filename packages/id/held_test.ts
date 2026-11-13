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
