// Classified public rows and sparse private ownership, shared by native and
// workerd checks of the visibility cost of whole-graph and edge tallies.
import { Archetypes, eidOf } from '@yaks/archetype/sets'
import { loadVocab } from '@yaks/vocab'
import { archetypeSet, col, type Driver, insert } from './core.ts'

export let tallyVocab = loadVocab({
  $defs: {
    entity: {
      component: true,
      properties: { archetype: { type: 'string', ref: 'archetype' } },
    },
    archetype: { component: true, properties: { tables: { type: 'string' } } },
    draft: {
      component: true,
      properties: { by: { type: 'string', ref: 'entity' } },
    },
    apply_receipt: { component: true },
    tombstone: { component: true },
    note: { component: true },
    edge: {
      component: true,
      properties: {
        from: { type: 'string', ref: 'entity' },
        to: { type: 'string', ref: 'entity' },
      },
    },
  },
})
export let seedTallies = (d: Driver, size = 256) => {
  d.query({
    t: 'create table',
    name: 'entity',
    cols: [
      { name: 'id', type: 'integer', pk: true },
      { name: 'eid', type: 'text', unique: true },
      { name: 'num', type: 'integer' },
      { name: 'archetype', type: 'integer' },
    ],
  })
  d.query({
    t: 'create index',
    name: 'entity_archetype',
    on: 'entity',
    cols: [col('archetype')],
  })
  for (
    let name of [
      'archetype',
      'draft',
      'apply_receipt',
      'tombstone',
      'note',
      'edge',
    ]
  ) {
    let extra = name == 'archetype'
      ? [{ name: 'tables', type: 'text' }]
      : name == 'draft'
      ? [{ name: 'by', type: 'integer' }]
      : name == 'edge'
      ? [{ name: 'from', type: 'integer' }, { name: 'to', type: 'integer' }]
      : []
    d.query({
      t: 'create table',
      name,
      cols: [{ name: 'entity', type: 'integer', pk: true }, ...extra],
    })
  }
  for (let prop of ['from', 'to']) {
    d.query({
      t: 'create index',
      name: `edge_${prop}`,
      on: 'edge',
      cols: [col(prop)],
    })
  }
  let sets = new Map<string, number>(),
    cache = new Archetypes(),
    ids = new Map<string, number>()
  let shape = (names: string[]) => {
    let text = JSON.stringify([...names].sort())
    if (!sets.has(text)) sets.set(text, 10000 + sets.size)
    return sets.get(text)!
  }
  let descriptor = shape(['archetype']),
    plain = shape(['note']),
    link = shape(['edge'])
  let owners = Array.from(
    { length: size },
    (_, i) => ({ id: i + 1, eid: `note-${i}`, archetype: plain }),
  )
  owners.push({ id: 3000, eid: 'reader', archetype: shape([]) }, {
    id: 3001,
    eid: 'other',
    archetype: shape([]),
  })
  for (
    let [id, eid, names] of [
      [4000, 'mine', ['draft', 'note']],
      [4001, 'foreign', ['draft', 'note']],
      [4002, 'receipt', ['apply_receipt', 'note']],
      [4003, 'dead', ['note', 'tombstone']],
    ] as const
  ) owners.push({ id, eid, archetype: shape([...names]) })
  for (let i = 0; i < size; i++) {
    owners.push({ id: 5000 + i, eid: `edge-${i}`, archetype: link })
  }
  for (let row of owners) d.query(insert('entity', row))
  for (
    let row of owners.filter((r) => r.id < 3000 || r.id >= 4000 && r.id < 5000)
  ) d.query(insert('note', { entity: row.id }))
  for (let i = 0; i < size; i++) {
    d.query(
      insert('edge', {
        entity: 5000 + i,
        from: i < 4 ? 4001 : 1,
        to: i < 4 ? 4000 : 2,
      }),
    )
  }
  d.query(
    insert('draft', { entity: 4000, by: 3000 }, { entity: 4001, by: 3001 }),
  )
  d.query(insert('apply_receipt', { entity: 4002 }))
  d.query(insert('tombstone', { entity: 4003 }))
  for (let [tables, id] of sets) {
    let eid = eidOf(JSON.parse(tables))
    ids.set(eid, id)
    cache.decode(tables)
    d.query(insert('entity', { id, eid, archetype: descriptor }))
    d.query(insert('archetype', { entity: id, tables }))
  }
  let catalog = Object.assign(archetypeSet(cache, ids), { held: true })
  return { catalog, plain: eidOf(['note']), private: eidOf(['draft', 'note']) }
}
export let tallyScope = {
  visibility: { entity: '!apply_receipt&(!draft|.draft.by=reader)' },
}
