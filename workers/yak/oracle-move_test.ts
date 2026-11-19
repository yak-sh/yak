import { equal, test } from '@yaks/testing'
import type { Bundle, Comp, Graph } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import { link } from '@yaks/edge'
import { OWNERS } from '@yaks/platform/operator-owner'
import { operatorStore } from './operator-store.ts'
import { durable } from '../../packages/durable-object/testing.ts'
import { operatorApi } from './operator-api.ts'
import { seenBy } from './operator-access.ts'
import {
  BATCH,
  oracleBackfill,
  ORACLES,
  projectRepair,
  PROJECTS,
} from './oracle-move.ts'
import { oracleOf } from './operator-oracles.ts'
import { state } from './testing.ts'

let id = () => crypto.randomUUID()
let [person, other, space, subject] = Array.from({ length: 4 }, id)
let base = await operatorStore(durable())
let kept = new Map<string, string>()
let marks = {
  del: (k: string) => void kept.delete(k),
  get: (k: string) => kept.get(k),
  set: (k: string, v: string) => void kept.set(k, v),
}
let store = { ...base, marks }
let source = derivedEid(`operator-oracle|memories|${subject}`)
let edge = link(subject, 'contains', source)
let target = oracleOf(person, subject)
let current = id()
let own = (b: Bundle): Bundle => ({
  ...b,
  operator_oracle: { person, subject },
})
let reference = id()
await store.g.apply([
  // The space's home, a topic too, which every task and decision is filed under.
  { entity: { eid: space }, project: {}, topic: { name: 'club' } },
  {
    entity: { eid: subject },
    topic: { name: 'Legacy private space' },
    content: { body: 'Legacy learned secret' },
  },
  { entity: { eid: source }, doc: { body: 'Legacy memory secret' } },
  edge,
  {
    entity: { eid: reference },
    doc: { title: 'A visible reference' },
    cites: {},
    edge: { from: reference, to: source },
  },
  own({
    entity: { eid: target },
    topic: { name: 'Reader private space' },
    doc: { title: 'Private space' },
  }),
  own({ entity: { eid: current }, doc: { body: 'Reader memory secret' } }),
  own(link(target, 'contains', current)),
  ...Array.from(
    { length: BATCH },
    (_, i) => ({ entity: { eid: id() }, topic: { name: `Old ${i}` } }),
  ),
], { trusted: true })
let reads: string[] = []
let repaired = {
  ...store,
  g: {
    ...store.g,
    read: ((q, o) => {
      reads.push(String(q))
      return store.g.read(q, o)
    }) as Graph['read'],
    get: ((ids, comps, o) => {
      reads.push((comps ?? []).join(','))
      return store.g.get(ids, comps, o)
    }) as Graph['get'],
  },
}
let door = operatorApi(store, state())
let read = async (who: string, q: string) => {
  let response = await door.answer(
    new Request('https://builder/api/query?q=' + encodeURIComponent(q)),
    { person: who, space },
  )
  equal(
    response.status,
    200,
    response.status == 200 ? undefined : await response.clone().text(),
  )
  return await response.json() as Bundle[]
}
let hidden = async () => {
  for (let who of [person, other]) {
    equal(
      await read(who, `.entity.eid=${subject},${source},${edge.entity.eid}&*`),
      [],
    )
    equal(
      await read(who, `.entity.eid=${reference}&.fields=edge.to.doc.body`),
      [{ entity: { eid: reference } }],
    )
  }
  equal(
    (await read(person, `.entity.eid=${current}&.fields=doc.body`))[0].doc,
    { body: 'Reader memory secret' },
  )
  equal(await read(other, `.entity.eid=${target},${current}&*`), [])
}

// Read the pending ownership pass before any completed read caches it.
await hidden()
kept.set(OWNERS, 'done')
await hidden()
let more = await oracleBackfill(repaired)
await hidden()
while (await oracleBackfill(repaired)) { /* bounded batches */ }
await hidden()
let again = await oracleBackfill(repaired)
let rows = await store.g.get([subject, source, edge.entity.eid])
let visible = await seenBy(store, other).get([source])
let home = await seenBy(store, other).get([space], ['project'])

test('the query door hides legacy projections before repair, between batches and after completion', () => {
  equal([more, again, kept.get(ORACLES)], [true, false, 'done'])
  equal(rows.every((b) => !!b.owner && !!b.operator_oracle), true)
  equal(rows.map((b) => (b.owner as Comp).person ?? null), [null, null, null])
  equal((rows[0].content as Comp).body, 'Legacy learned secret')
  equal((rows[1].doc as Comp).body, 'Legacy memory secret')
  equal(reads.some((q) => /doc|content|\*/.test(q)), false)
  equal(visible.length, 0)
  equal(home.map((b) => b.entity.eid), [space])
})

// A store the pass ran in before it knew a project from an oracle: its
// project quarantined, with what the legacy oracle learned on it.
let hid = { ...await operatorStore(durable()), marks }
let learned = derivedEid(`operator-oracle|learned|${space}`)
await hid.g.apply([{
  entity: { eid: space },
  project: {},
  topic: { name: 'club' },
  content: { body: 'Legacy learned secret' },
  operator_oracle: { person: null, subject: space },
}], { trusted: true })
let before = await seenBy(hid, person).get([space], ['project'])
while (await projectRepair(hid)) { /* bounded batches */ }
let after = await seenBy(hid, person).get([space], ['project', 'content'])
let moved = await hid.g.get([learned])

test('a quarantined project is restored to every reader, its learned words kept hidden', () => {
  equal([before.length, kept.get(PROJECTS)], [0, 'done'])
  equal(after.map((b) => [b.entity.eid, !!b.project, b.content ?? null]), [
    [space, true, null],
  ])
  equal((moved[0].content as Comp).body, 'Legacy learned secret')
  equal((moved[0].owner as Comp).person ?? null, null)
})
