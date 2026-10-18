import './sqlitepath.ts'
// Selective session and workspace reads must not build global visible component
// owning sets, even when statistics still describe the small initial graph.
import { Database } from '@db/sqlite'
import { equal, ok, test } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'
import { compile, insert, render } from '@yaks/sql'
import { parse } from '@yaks/query'
import { driver } from './native.ts'
import { storage } from './mod.ts'
import { sqlitePath } from './sqlitepath.ts'

let status = Deno.dlopen(sqlitePath, {
  sqlite3_stmt_status: { parameters: ['pointer', 'i32', 'i32'], result: 'i32' },
})
let db = new Database(':memory:'), d = driver(db)
let vocab = loadVocab({
  $defs: {
    entry: {
      component: true,
      type: 'object',
      index: [['session', 'seq']],
      properties: {
        session: { type: 'string', ref: 'entity' },
        seq: { type: 'integer' },
      },
    },
    using: {
      component: true,
      type: 'object',
      properties: { model: { type: 'string' } },
    },
    ask: {
      component: true,
      type: 'object',
      properties: { to: { type: 'string', ref: 'entity' } },
    },
    claim: {
      component: true,
      type: 'object',
      properties: { session: { type: 'string', ref: 'entity' } },
    },
    home: {
      component: true,
      type: 'object',
      properties: { workspace: { type: 'string', ref: 'entity' } },
    },
    task: { component: true, type: 'object' },
    session: { component: true, type: 'object' },
    apply_receipt: { component: true, type: 'object' },
  },
})
storage(d, vocab).install()
d.query(insert('entity', { id: 1, eid: 'target' }, { id: 2, eid: 'other' }))
let seed = (start: number, count: number, owner: number) => {
  let rows = Array.from({ length: count }, (_, n) => start + n)
  d.query(insert('entity', ...rows.map((id) => ({ id, eid: `e${id}` }))))
  d.query(
    insert(
      'entry',
      ...rows.map((entity) => ({ entity, session: owner, seq: entity })),
    ),
  )
  d.query(insert('using', ...rows.map((entity) => ({ entity, model: 'test' }))))
  d.query(insert('ask', ...rows.map((entity) => ({ entity, to: owner }))))
  d.query(
    insert('claim', ...rows.map((entity) => ({ entity, session: owner }))),
  )
  d.query(
    insert('home', ...rows.map((entity) => ({ entity, workspace: owner }))),
  )
  for (let comp of ['task', 'session']) {
    d.query(insert(comp, ...rows.map((entity) => ({ entity }))))
  }
}
seed(3, 3, 1)
d.query(insert('apply_receipt', { entity: 5 }))
d.query({ t: 'pragma', name: 'optimize', value: 0x10002 })
for (let start = 6; start < 5006; start += 500) seed(start, 500, 2)

for (let scoped of [false, true]) {
  for (
    let [name, query, expected] of [
      [
        'answering requests',
        '.entry.session=target&.using&?ask&?entry',
        scoped ? ['e3', 'e4'] : ['e3', 'e4', 'e5'],
      ],
      [
        'latest ask',
        '.entry.session=target&.ask&.limit=1',
        scoped ? ['e4'] : ['e5'],
      ],
      [
        'workspace tasks',
        '.task&.claim.session=target&*',
        scoped ? ['e3', 'e4'] : ['e3', 'e4', 'e5'],
      ],
      [
        'workspace borrowers',
        '.home.workspace=target&.session&*',
        scoped ? ['e3', 'e4'] : ['e3', 'e4', 'e5'],
      ],
    ] as const
  ) {
    let q = render(compile(parse(query), vocab, {
      visibility: scoped ? { entity: '!apply_receipt' } : undefined,
    }))
    test(`${scoped ? 'scoped' : 'plain'} ${name} seek owners instead of global membership`, () => {
      let stmt = db.prepare(q.sql)
      try {
        equal(stmt.all(...q.params).map((r) => r.eid), [...expected])
        let steps = status.symbols.sqlite3_stmt_status(stmt.unsafeHandle, 4, 0)
        ok(steps < 2000, `${steps} VM steps\n${q.sql}`)
      } finally {
        stmt.finalize()
      }
    })
  }
}
