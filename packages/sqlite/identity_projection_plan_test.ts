// Identity/shape pages retain their component seek, order and cursor without
// paying for a second pass through the selected owners.
import { equal, ok, test } from '@yaks/testing'
import './sqlitepath.ts'
import { Database } from '@db/sqlite'
import { archetypeDoc } from '@yaks/archetype'
import { loadVocab } from '@yaks/vocab'
import { compile, insert, render } from '@yaks/sql'
import { parse } from '@yaks/query'
import { driver } from './native.ts'
import { storage } from './mod.ts'
import { sqlitePath } from './sqlitepath.ts'

let counters = Deno.dlopen(sqlitePath, {
  sqlite3_stmt_status: { parameters: ['pointer', 'i32', 'i32'], result: 'i32' },
})
let vocab = loadVocab([archetypeDoc, {
  $defs: {
    entity: {
      component: true,
      type: 'object',
      properties: { archetype: { type: 'string', ref: 'archetype' } },
    },
    entry: {
      component: true,
      type: 'object',
      index: [['session', 'seq']],
      properties: {
        session: { type: 'string', ref: 'entity' },
        seq: { type: 'integer' },
      },
    },
    hidden: { component: true, type: 'object' },
  },
}])
let db = new Database(':memory:'), d = driver(db)
storage(d, vocab).install()
d.query(
  insert('entity', { id: 1, eid: 'session' }, { id: 2, eid: 'shape' }, {
    id: 2000,
    eid: 'other-shape',
  }),
)
let add = (start: number, n: number) => {
  for (let id = start; id < start + n; id++) {
    d.query(
      insert('entity', {
        id,
        eid: `e${id}`,
        archetype: id % 3 == 0 ? null : id % 2 ? 2000 : 2,
      }),
    )
    // Ties and NULLs exercise both cursor comparisons, not just an index range.
    d.query(
      insert('entry', {
        entity: id,
        session: 1,
        seq: id < 10 ? null : Math.floor(id / 2),
      }),
    )
  }
}
add(3, 20)
d.query({ t: 'pragma', name: 'optimize', value: 0x10002 })
add(23, 1000)
d.query(insert('hidden', { entity: 1020 }))
d.query(insert('tombstone', { entity: 1019, deleted_at: 'then' }))
let prepare = (line: string, visibility?: { entity: string }) => {
  let q = render(compile(parse(line), vocab, { visibility }))
  let stmt = db.prepare(q.sql)
  try {
    let rows = stmt.all(...q.params)
    return {
      rows,
      steps: counters.symbols.sqlite3_stmt_status(stmt.unsafeHandle, 4, 0),
    }
  } finally {
    stmt.finalize()
  }
}
for (let visibility of [undefined, { entity: '!hidden' }]) {
  for (
    let after of [
      '',
      '&.after=e1022',
      '&.after=e1000',
      '&.after=e10',
      '&.after=e8',
      '&.after=missing',
    ]
  ) {
    let line = `.entry.session=session&.order=-entry.seq&.limit=16${after}`
    let base = prepare(line, visibility)
    let page = prepare(
      `${line}&.fields=entity.eid,entity.archetype`,
      visibility,
    )
    test(`identity shape page retains ordered ties and cursor ${after || 'first'} ${visibility ? 'scoped' : 'plain'}`, () => {
      equal(page.rows.map((r) => r.eid), base.rows.map((r) => r.eid))
      for (let r of page.rows) {
        equal(r['entity.eid'], r.eid)
        let id = Number(String(r.eid).slice(1))
        equal(
          r['entity.archetype'],
          id % 3 == 0 ? null : id % 2 ? 'other-shape' : 'shape',
        )
      }
      // Scoped references additionally check the target's visibility; that
      // policy work is per shape hint, not a second pass over the page.
      ok(
        page.steps <=
          base.steps + page.rows.length * (visibility ? 36 : 12) + 20,
        `${page.steps} projected VM steps vs ${base.steps} identity steps`,
      )
    })
  }
}
db.close()
