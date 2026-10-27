// Reference filters survive whichever source the planner chooses for a shape.
import { equal, test } from '@yaks/testing'
import { graph } from '@yaks/graph'
import { archetypeDoc, archetypes } from '@yaks/archetype'
import { kernelDoc } from '@yaks/kernel'
import { idDoc } from '@yaks/id/vocab'
import { loadVocab } from '@yaks/vocab'
import { storage } from './mod.ts'
import { mem } from './testing.ts'

let vocab = loadVocab([kernelDoc, idDoc, archetypeDoc, {
  $defs: {
    item: {
      component: true,
      properties: { target: { type: 'string', ref: 'entity', index: true } },
    },
    origin: {
      component: true,
      properties: { via: { type: 'string', ref: 'entity' } },
    },
    filed: {
      component: true,
      properties: { project: { type: 'string', ref: 'entity', index: true } },
    },
    session: { component: true, properties: {} },
    notified: { component: true, properties: {} },
  },
}])
let store = storage(mem(), vocab, { number: true })
store.install()
let g = graph({ storage: store, vocab, plugins: [archetypes()] })
g.apply([
  { entity: { eid: 'project' }, filed: {} },
  { entity: { eid: 'human' }, filed: {} },
  { entity: { eid: 'agent' }, session: {} },
  {
    entity: { eid: 'work' },
    origin: { via: 'agent' },
    filed: { project: 'project' },
  },
  {
    entity: { eid: 'agent-item' },
    item: { target: 'work' },
    origin: { via: 'agent' },
  },
  {
    entity: { eid: 'human-item' },
    item: { target: 'work' },
    origin: { via: 'human' },
  },
  { entity: { eid: 'unknown-item' }, item: { target: 'work' } },
])
store.rows('.item .fields=entity.eid')
let ids = (q: string) => store.rows(q).map((r) => r.eid).sort()

for (
  let [name, suffix] of [
    ['indexed reference', '.item.target.filed.project=project'],
    ['numbered page', '.order=entity.num .limit=10'],
    ['shape candidates', ''],
  ]
) {
  for (
    let [direction, predicate, expected] of [
      ['human', '!origin.via.session', ['human-item', 'unknown-item']],
      ['agent', '.origin.via.session', ['agent-item']],
    ] as const
  ) {
    test(`${direction} reference presence survives ${name} selection`, () => {
      equal(
        ids(
          `.item !notified .item.target.origin.via.session ${predicate} ${suffix}`,
        ),
        [...expected],
      )
    })
  }
}
