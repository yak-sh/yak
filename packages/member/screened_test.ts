// A person's read of whole bundles puts its rows to their scope once, in the
// query that selects them: neither the store's gather of those rows nor
// personal's answer screens them again, and each row's spine is read once.
// Read as a web's read worker reads, through the read-only graph.
import { type Comp, graph } from '@yaks/graph'
import { graph as readonly } from '@yaks/graph/read'
import { storage } from '@yaks/sqlite'
import { open } from '@yaks/sqlite/db'
import { storage as reading } from '@yaks/sqlite/read-store'
import { channel, type Event } from '@yaks/trace'
import { loadVocab } from '@yaks/vocab'
import { equal, test } from '@yaks/testing'
import { personal } from './personal.ts'

let vocab = loadVocab({
  $defs: {
    entity: { component: true, type: 'object' },
    person: { component: true, type: 'object' },
    note: {
      component: true,
      type: 'object',
      properties: {
        by: { type: 'string', ref: 'entity', death: 'keep' },
        text: { type: 'string' },
      },
    },
    task: {
      component: true,
      type: 'object',
      properties: { about: { type: 'string', ref: 'entity', death: 'keep' } },
    },
  },
})
let db = open(':memory:')
await graph({ vocab, storage: storage(db, vocab) }).apply([
  { entity: { eid: 'alice' }, person: {} },
  { entity: { eid: 'bob' }, person: {} },
  { entity: { eid: 'mine' }, note: { by: 'alice', text: 'mine' } },
  { entity: { eid: 'his' }, note: { by: 'bob', text: 'his' } },
  { entity: { eid: 'a' }, task: { about: 'mine' } },
  { entity: { eid: 'b' }, task: { about: 'his' } },
], { trusted: true })
let g = readonly({ vocab, storage: reading(db, vocab) })
g.use(personal(vocab, { note: 'by' }))

// What a read answers, and the statements it ran of each kind.
let SPINE = 'select "e"."id", "e"."eid", "e"."num", (select "t"."entity"'
let read = async (q: string, person: string) => {
  let sql: string[] = []
  let off = channel(g).subscribe((e: Event) => {
    if (e.stage == 'start' && e.kind == 'sql' && e.sql) sql.push(e.sql)
  }, { history: false })
  let rows = await g.read(q, { person })
  off()
  return {
    rows: rows.map((b) => [
      b.entity.eid,
      b.task ? (b.task as Comp).about : (b.note as Comp).text,
    ]),
    spines: sql.filter((s) => s.startsWith(SPINE)).length,
    screens: sql.filter((s) => s.includes('"__requested"')).length,
  }
}
let cases: [string, string, string, unknown][] = [
  ['her tasks, his note out of reach', '.task&*', 'alice', {
    rows: [['a', 'mine'], ['b', null]],
    spines: 1,
    screens: 1,
  }],
  ['her notes', '.note&*', 'alice', {
    rows: [['mine', 'mine']],
    spines: 1,
    screens: 1,
  }],
  ['his notes', '.note&*', 'bob', {
    rows: [['his', 'his']],
    spines: 1,
    screens: 1,
  }],
]
for (let [name, q, person, want] of cases) {
  test(`a person's read screens its rows once: ${name}`, async () =>
    equal(await read(q, person), want))
}
