import { test } from '@yaks/testing'
import './testing.ts'
import { assertEquals } from '@std/assert'
import { bundlesOf, changesOf, yakLine } from './wire.ts'

test('a batch leaves as one bundle per entity, without spine writes', () => {
  assertEquals(
    bundlesOf([
      { eid: 'a', name: 'doc', comp: { eid: 'a', title: 'One' } },
      { eid: 'a', name: 'doc', comp: { body: 'more' } },
      { eid: 'a', name: 'claim', comp: null },
      { eid: 'a', name: 'entity', comp: { num: 3 } },
      { eid: 'b', name: 'doc', comp: { title: 'Two' } },
      { eid: 'b', name: 'entity', comp: null },
    ]),
    [
      {
        entity: { eid: 'a' },
        doc: { title: 'One', body: 'more' },
        claim: null,
      },
      { entity: { eid: 'b' }, tombstone: {} },
    ],
  )
})

test('an answer lands as changes: the spine, each component, a death', () => {
  assertEquals(
    changesOf([
      { entity: { eid: 'a', num: 3 }, doc: { title: 'One' }, claim: null },
      { entity: { eid: 'b' }, tombstone: {} },
    ]),
    [
      { eid: 'a', name: 'entity', comp: { num: 3 } },
      { eid: 'a', name: 'doc', comp: { title: 'One' } },
      { eid: 'a', name: 'claim', comp: null },
      { eid: 'b', name: 'entity', comp: null },
    ],
  )
})

test('a line asks the host by .entity.eid and leaves riders and projections out', () => {
  assertEquals(yakLine('id=a,b'), '.entity.eid=a,b')
  assertEquals(
    yakLine('id=a&.edges.peers=task.status,doc.title&.edges.limit=100'),
    '.entity.eid=a',
  )
  assertEquals(
    yakLine('.task&.fields=doc.title&.edges[requires]&.limit=5'),
    '.task&.limit=5',
  )
})

test('a removed component is replaced, and repeat attention gets a fresh server stamp', async () => {
  let { graph } = await import('@yaks/graph')
  let { ram } = await import('@yaks/ram')
  let { loadVocab } = await import('@yaks/vocab')
  let { kernelDoc } = await import('@yaks/kernel')
  let { docDoc } = await import('@yaks/doc')
  let vocab = loadVocab([kernelDoc, docDoc])
  let g = graph({ vocab, storage: ram(vocab) })
  await g.apply([{
    entity: { eid: 'thread' },
    doc: { title: 'Before', body: 'old' },
    archived: {},
  }], { now: '2026-10-02T12:00:00.000Z' })
  await g.apply(
    bundlesOf([
      { eid: 'thread', name: 'doc', comp: null },
      { eid: 'thread', name: 'doc', comp: { title: 'After' } },
      { eid: 'thread', name: 'archived', comp: null },
      { eid: 'thread', name: 'archived', comp: {} },
    ]),
    { now: '2026-10-02T13:00:00.000Z' },
  )
  let [thread] = await g.get(['thread'])
  assertEquals(thread.doc, { title: 'After' })
  assertEquals(thread.archived, { at: '2026-10-02T13:00:00.000Z' })
})
