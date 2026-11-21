// A table holding one row takes no statistics, and is analyzed once it holds
// more, though the store as a whole grew less than tenfold: SQLite plans a
// probe of a table its statistics say holds one row as a scan of it, so a
// lookup of 29 receipts read every `cost` row once per receipt (bug
// b5285b5d).
import { graph } from '@yaks/graph'
import { DEPTH, renderStable, VARIABLES } from '@yaks/sql'
import { equal, ok, test } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'
import { storage } from './mod.ts'
import { stepping } from './testing.ts'

let vocab = loadVocab({
  $defs: Object.fromEntries(
    ['cost', 'model_reservation'].map((c) => [c, {
      component: true,
      type: 'object',
      properties: { dollars: { type: 'number' } },
    }]),
  ),
})
let eid = (i: number) =>
  `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`
let costs = (from: number, n: number) =>
  Array.from({ length: n }, (_, i) => ({
    entity: { eid: eid(from + i) },
    cost: { dollars: from + i },
  }))

// A Durable Object's engine: full analysis, its stored bytes never growing
// tenfold, and its statements rendered as its driver renders them.
let { driver: engine, steps } = stepping()
let driver = Object.assign({
  ...engine,
  query: (s: Parameters<typeof engine.query>[0]) =>
    engine.query(renderStable(s, VARIABLES, DEPTH)),
}, { statistics: { bytes: () => 1 } })
let open = () => {
  let s = storage(driver, vocab)
  s.install()
  while (s.analyze(1));
  return s
}
let s = open()
graph({ storage: s, vocab }).apply(costs(0, 1))
s = open()
graph({ storage: s, vocab }).apply(costs(1, 3000))
s = open()

test('a lookup of receipts seeks a component analyzed at one row and grown since', () => {
  let ids = Array.from({ length: 29 }, (_, i) => eid(i * 100))
  let start = steps()
  let rows = s.rows(
    `.entity.eid=${
      ids.join(',')
    }&.fields=cost.dollars,model_reservation.dollars`,
  )
  let cost = steps() - start
  equal(rows.length, 29)
  ok(cost < 3_000, `${cost} VM steps for 29 receipts`)
})
