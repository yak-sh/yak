// Shared classified rows for native and Worker tests of finite owner reads.
import { Archetypes, eidOf } from '@yaks/archetype/sets'
import { loadVocab } from '@yaks/vocab'
import type { ReadOpts } from '@yaks/graph'
import { archetypeSet, col, type Driver, insert, type Row } from './core.ts'

let facets = Array.from({ length: 6 }, (_, i) => `facet${i}`)
export let ownerVocab = loadVocab({
  $defs: {
    entity: {
      component: true,
      properties: {
        num: { type: 'number' },
        archetype: { type: 'string', ref: 'archetype' },
      },
    },
    archetype: { component: true, properties: { tables: { type: 'string' } } },
    post: {
      component: true,
      kind: true,
      properties: {
        title: { type: 'string' },
        author: { type: 'string', ref: 'person' },
      },
    },
    person: { component: true, properties: { name: { type: 'string' } } },
    comment: {
      component: true,
      properties: { post: { type: 'string', ref: 'post' } },
    },
    blocked: { component: true, properties: {} },
    tombstone: { component: true, properties: {} },
    ...Object.fromEntries(
      facets.map((name) => [name, { component: true, properties: {} }]),
    ),
  },
})

export let seedOwners = (d: Driver) => {
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
  for (
    let [name, extra] of [
      ['archetype', [{ name: 'tables', type: 'text' }]],
      ['post', [{ name: 'title', type: 'text' }, {
        name: 'author',
        type: 'integer',
      }]],
      ['person', [{ name: 'name', type: 'text' }]],
      ['comment', [{ name: 'post', type: 'integer' }]],
      ...['blocked', 'tombstone', ...facets].map((n) => [n, []]),
    ] as [string, { name: string; type: 'text' | 'integer' }[]][]
  ) {
    d.query({
      t: 'create table',
      name,
      cols: [
        { name: 'entity', type: 'integer', pk: true },
        ...extra,
      ],
    })
  }
  d.query({
    t: 'create index',
    name: 'entity_num',
    on: 'entity',
    cols: [col('num')],
  })
  let sets = new Map<string, number>(), cache = new Archetypes()
  let ids = new Map<string, number>()
  let shape = (names: string[]) => {
    let tables = JSON.stringify([...names].sort())
    let id = sets.get(tables)
    if (id == null) sets.set(tables, id = 2000 + sets.size)
    return id
  }
  let descriptor = shape(['archetype'])
  let owners = [
    { id: 1, eid: 'target', num: 7, archetype: shape(['post']) },
    { id: 2, eid: 'closed', num: 8, archetype: shape(['blocked', 'post']) },
    { id: 3, eid: 'person', num: 9, archetype: shape(['person']) },
    { id: 4, eid: 'grave', num: 10, archetype: shape(['post', 'tombstone']) },
    { id: 5, eid: 'P-7', num: 11, archetype: shape(['post']) },
    { id: 6, eid: 'comment', num: 12, archetype: shape(['comment']) },
    ...Array.from({ length: 64 }, (_, i) => ({
      id: 1000 + i,
      eid: `unrelated-${i}`,
      num: 1000 + i,
      archetype: shape(['post', ...facets.filter((_, bit) => i & (1 << bit))]),
    })),
  ]
  for (let row of owners) d.query(insert('entity', row))
  for (let [tables, id] of sets) {
    ids.set(cache.decode(tables).eid, id)
    d.query(
      insert('entity', {
        id,
        eid: eidOf(JSON.parse(tables)),
        archetype: descriptor,
      }),
    )
    d.query(insert('archetype', { entity: id, tables }))
  }
  for (let owner of owners.filter((r) => r.id != 3 && r.id != 6)) {
    d.query(
      insert('post', {
        entity: owner.id,
        title: owner.eid == 'target' ? 'Chosen' : owner.eid,
        author: 3,
      }),
    )
  }
  d.query(insert('blocked', { entity: 2 }))
  d.query(insert('person', { entity: 3, name: 'Reader' }))
  d.query(insert('tombstone', { entity: 4 }))
  d.query(insert('comment', { entity: 6, post: 1 }))
  for (let i = 0; i < 64; i++) {
    for (let [bit, name] of facets.entries()) {
      if (i & (1 << bit)) d.query(insert(name, { entity: 1000 + i }))
    }
  }
  return Object.assign(archetypeSet(cache, ids), { held: true })
}

export type OwnerCase = {
  name: string
  query: string
  opts?: ReadOpts
  rows: Row[]
  bounded?: boolean
  hot?: boolean
}
let target = [{ eid: 'target' }]
export let orderedOwners = (rows: Row[]) =>
  [...rows].sort((a, b) => String(a.eid).localeCompare(String(b.eid)))
export let ownerCases: OwnerCase[] = [
  {
    name: 'canonical candidates',
    query: '.post !blocked',
    opts: { eids: ['target'] },
    rows: target,
    bounded: true,
  },
  {
    name: 'a mandatory identity',
    query: '.entity.eid=target .post !blocked',
    rows: target,
    bounded: true,
  },
  {
    name: 'nested conjunctions',
    query: '(.entity.eid=target (.post !blocked))',
    rows: target,
    bounded: true,
  },
  {
    name: 'a finite identity beside a range',
    query: '.entity.eid=target..z .entity.eid=target .post !blocked',
    rows: target,
    bounded: true,
  },
  {
    name: 'an identity outside an OR',
    query: '.entity.eid=target (.post|.person) !blocked',
    rows: target,
    bounded: true,
  },
  {
    name: 'an empty candidate set',
    query: '.post !blocked',
    opts: { eids: [] },
    rows: [],
    bounded: true,
  },
  {
    name: 'absence on the selected owner',
    query: '.post !blocked',
    opts: { eids: ['closed'] },
    rows: [],
    bounded: true,
  },
  {
    name: 'a selected grave',
    query: '.post !blocked',
    opts: { eids: ['grave'] },
    rows: [],
    bounded: true,
  },
  {
    name: 'canonical human-looking eids',
    query: '.post !blocked',
    opts: { eids: ['P-7'] },
    rows: [{ eid: 'P-7' }],
    bounded: true,
  },
  {
    name: 'human identity operands',
    query: '.entity.eid=P-7 .post !blocked',
    rows: target,
    bounded: true,
  },
  {
    name: 'mixed identity operands',
    query: '.entity.eid=P-7,target .post !blocked',
    rows: target,
    bounded: true,
  },
  {
    name: 'a reference outside candidates',
    query: '.comment.post.post.title=Chosen',
    opts: { eids: ['comment'] },
    rows: [{ eid: 'comment' }],
    bounded: true,
  },
  {
    name: 'a projected reference',
    query: '.entity.eid=target .post .fields=post.author.person.name',
    rows: [{ eid: 'target', 'post.author.person.name': 'Reader' }],
    bounded: true,
  },
  {
    name: 'visibility on selected owners',
    query: '.post !blocked',
    opts: {
      eids: ['target', 'P-7'],
      visibility: { entity: '.entity.eid=target' },
    },
    rows: target,
    bounded: true,
  },
  {
    name: 'a hidden referent',
    query: '.post.author.person.name=Reader',
    opts: { eids: ['target'], visibility: { entity: '.post' } },
    rows: [],
    bounded: true,
  },
  {
    name: 'an absent component on the selected owner',
    query: '.post !blocked',
    opts: { eids: ['person'] },
    rows: [],
    bounded: true,
  },
  {
    name: 'a nonnumeric human-looking operand',
    query: '.entity.eid=P-nope .post !blocked',
    rows: [],
    bounded: true,
  },
  {
    name: 'presence on a referent outside candidates',
    query: '.comment.post.post !comment.post.blocked',
    opts: { eids: ['comment'] },
    rows: [{ eid: 'comment' }],
    bounded: true,
  },
  {
    name: 'an already held catalog',
    query: '.entity.eid=target .post !blocked',
    rows: target,
    hot: true,
  },
  {
    name: 'an unbounded OR arm',
    query: '.entity.eid=target|.comment',
    rows: [{ eid: 'comment' }, { eid: 'target' }],
  },
]
