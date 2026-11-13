// A clause an extension compiles to a few owners in hand (`Extension.few`,
// as `.near` names its nearest eight) drives the read: beside a disjunction
// whose arms admit most of the graph, the read costs the same however many
// entities the graph holds. The box's graph selected every owner of both arms
// of `(!entry|.created.by.person)` to find the eight among them.
import { among, col, type Extension, select, table, val } from '@yaks/sql'
import { loadVocab } from '@yaks/vocab'
import { equal, ok, test } from '@yaks/testing'
import { stepping } from './testing.ts'
import { storage } from './mod.ts'

let vocab = loadVocab({
  $defs: {
    person: { component: true },
    entry: { component: true },
    doc: { component: true, properties: { title: { type: 'string' } } },
    created: {
      component: true,
      properties: {
        by: { type: 'string', ref: 'entity', index: true },
        via: { type: 'string', ref: 'entity', index: true },
      },
    },
  },
})

// A graph of `n` transcript entries and `n` documents, half of each written
// by a person, read through a stand-in for `.near` naming three of them.
let graph = async (n: number) => {
  let { driver, steps } = stepping()
  let named: number[] = []
  let near: Extension = {
    name: 'near',
    few: ['near'],
    compile: {
      near: (c, site) =>
        c.kind == 'near' ? among(site.owner, named.map((id) => val(id))) : null,
    },
  }
  let s = storage(driver, vocab, { extend: [near] })
  s.install()
  await s.tx((tx) =>
    tx.patch([
      { entity: { eid: 'ada' }, person: {} },
      { entity: { eid: 'run' } },
      ...Array.from({ length: n }, (_, i) => [
        {
          entity: { eid: `entry-${i}` },
          entry: {},
          created: { by: i % 2 ? 'ada' : 'run', via: 'run' },
        },
        {
          entity: { eid: `doc-${i}` },
          doc: { title: `${i}` },
          created: { by: i % 2 ? 'ada' : 'run' },
        },
      ]).flat(),
    ])
  )
  let ids = new Map(
    driver.query(
      select({ cols: [col('id'), col('eid')], from: table('entity') }),
    )
      .map((r) => [String(r.eid), Number(r.id)]),
  )
  named = ['doc-1', 'doc-2', 'entry-1', 'entry-2'].map((e) => ids.get(e)!)
  return (q: string) => {
    let before = steps()
    let eids = s.rows(q).map((r) => String(r.eid)).sort()
    return { eids, steps: steps() - before }
  }
}
let q = '(!entry|.created.by.person)&.created.via!=elsewhere&.near=doc-0' +
  '&.limit=7&.fields=entity.eid'
let small = (await graph(200))(q), large = (await graph(4000))(q)

test('a read near an entity costs its neighbours, not the arms beside them', () => {
  equal(small.eids, ['doc-1', 'doc-2', 'entry-1'])
  equal(large.eids, small.eids)
  ok(large.steps < small.steps * 2, `${small.steps} -> ${large.steps} steps`)
})
