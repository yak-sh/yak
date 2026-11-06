// A limited read of a shape stops at its page, however many owners match or
// how many newer owners its absences screen out.
import { sqlitePath } from './sqlitepath.ts'
import { Database } from './legacy.ts'
import { archetypeDoc, archetypes } from '@yaks/archetype'
import { graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { type BindOpts, compile, render } from '@yaks/sql'
import { parse } from '@yaks/query'
import { cleanup, equal, ok, test } from '@yaks/testing'
import { driver } from './native.ts'
import { storage } from './mod.ts'
import { catalog } from './catalog.ts'

let db = new Database(':memory:'), sql = driver(db)
let vocab = loadVocab([archetypeDoc, {
  $defs: {
    doc: { component: true, type: 'object' },
    cost: { component: true, type: 'object' },
    screened: { component: true, type: 'object' },
    secret: { component: true, type: 'object' },
    other: { component: true, type: 'object' },
  },
}])
let store = storage(sql, vocab)
store.install()
let g = graph({ storage: store, vocab, plugins: [archetypes()] })
let rows = (n: number, name: string, comps: object) =>
  Array.from(
    { length: n },
    (_, i) => ({ entity: { eid: `${name}-${i}` }, ...comps }),
  )
// Owners the screen admits, then newer ones it leaves out, the way an app
// store's description rows sit above its own docs.
g.apply([
  ...rows(1000, 'shown', { doc: {}, cost: {} }),
  { entity: { eid: 'mine' }, doc: {}, other: {} },
  { entity: { eid: 'theirs' }, doc: {}, other: {} },
  { entity: { eid: 'hush' }, doc: {}, secret: {} },
  ...rows(3000, 'screened', { doc: {}, screened: {} }),
])
let steps = Deno.dlopen(sqlitePath, {
  sqlite3_stmt_status: { parameters: ['pointer', 'i32', 'i32'], result: 'i32' },
})
let scoped: BindOpts['visibility'] = { entity: '!secret' }
let masked: BindOpts['visibility'] = {
  entity: '!secret',
  components: { other: '.entity.eid=theirs' },
}
for (
  let [name, visibility, expected] of [
    ['scoped', scoped, [
      'shown-999',
      'shown-998',
      'shown-997',
      'shown-996',
      'shown-995',
    ]],
    // Only `theirs` wears an `other` this reader sees.
    ['masked', masked, [
      'mine',
      'shown-999',
      'shown-998',
      'shown-997',
      'shown-996',
    ]],
  ] as const
) {
  test(`a limited screened read stops at its page (${name})`, () => {
    if (name == 'masked') {
      cleanup(() => {
        steps.close()
        db.close()
      })
    }
    let q = render(compile(parse('.doc !screened !other .limit=5'), vocab, {
      archetypes: catalog(sql),
      visibility,
    }))
    let stmt = db.prepare(q.sql)
    try {
      equal(stmt.all(...q.params).map((r) => r.eid), [...expected])
      let vm = steps.symbols.sqlite3_stmt_status(stmt.unsafeHandle, 4, 0)
      ok(vm < 20_000, `${vm} instructions`)
    } finally {
      stmt.finalize()
    }
  })
}
