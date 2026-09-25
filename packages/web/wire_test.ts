import './testing.ts'
import { assertEquals } from '@std/assert'
import { bundlesOf, changesOf, yakLine } from './wire.ts'

Deno.test('a batch leaves as one bundle per entity, without spine writes', () => {
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

Deno.test('an answer lands as changes: the spine, each component, a death', () => {
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

Deno.test('a line asks the host by .eid and leaves riders and projections out', () => {
  assertEquals(yakLine('id=a,b'), '.eid=a,b')
  assertEquals(
    yakLine('id=a&.edges.peers=task.status,doc.title&.edges.limit=100'),
    '.eid=a',
  )
  assertEquals(
    yakLine('.task&.fields=doc.title&.edges[requires]&.limit=5'),
    '.task&.limit=5',
  )
})
