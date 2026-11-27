// A store to run steps in, for this package's tests: SQLite with a journal and
// an effect pool, steps written as rows, and a shop's words (orders,
// shipments, tasks filed to people). A call is answered the way any runner
// answers one, by writing its `result`; a person's step is a task they
// complete. A write returns once the pool has run what it owed, as a worker
// beside the store does.

import { whole } from '@yaks/query'
import { type Bundle, type Comp, graph } from '@yaks/graph'
import { docDoc } from '@yaks/doc/vocab'
import { edgeDoc, edgeKeywords, edges, link, traverse } from '@yaks/edge'
import { storage } from '@yaks/sqlite'
import { open } from '@yaks/sqlite/db'
import { backed, ddl, journal, log } from '@yaks/journal'
import { journalDoc } from '@yaks/journal/vocab'
import { toolsDoc } from '@yaks/tools/vocab'
import { wakeDoc, wakes } from '@yaks/wake'
import { loadVocab, metaDoc } from '@yaks/vocab'
import { effectDoc, effects } from '@yaks/effects'
import { workflowDoc } from './vocab.ts'
import { handlers, workflows } from './run.ts'

let shop = {
  $defs: {
    order: { component: true, properties: { item: { type: 'string' } } },
    shipment: {
      component: true,
      properties: { order: { type: 'string', ref: 'order', death: 'keep' } },
    },
    task: { component: true },
    filed: {
      component: true,
      properties: { assignee: { type: 'string', ref: 'entity' } },
    },
    completed: {
      component: true,
      properties: { at: { type: 'string', format: 'date-time' } },
    },
    note: { component: true, properties: { text: { type: 'string' } } },
    person: { component: true },
    contains: { component: true, edge: true },
    requires: { component: true, edge: true },
  },
}
export let vocab = loadVocab(
  [
    workflowDoc,
    docDoc,
    edgeDoc,
    toolsDoc,
    wakeDoc,
    journalDoc,
    metaDoc,
    effectDoc,
    shop,
  ],
  [edgeKeywords],
)

type Db = ReturnType<typeof open>

/** One process over the store in `db`: its graph, and `settle` to work the
 * effect pool. `defer` leaves the runs its own commits owe to whoever works
 * the pool next. */
export let process = (db: Db, defer = false) => {
  let fx = effects(vocab, {
    defer,
    write: (b) => g.apply(b, { trusted: true }),
  })
  let g = graph({
    storage: storage(db, vocab, {
      backed: backed(vocab),
      extend: [traverse(vocab)],
    }),
    vocab,
    actor: { by: 'ada' },
    plugins: [
      journal(log({ rows: (s) => db.query(s) }), vocab),
      edges(vocab),
      wakes(),
      workflows(),
      fx,
    ],
  })
  fx.handle(handlers(g))
  return { g, settle: () => fx.work(g) }
}

/** A fresh store: the graph, a write, a read, and `flow` to write a
 * workflow holding some steps. */
export let fixture = () => {
  let db = open(':memory:')
  let store = storage(db, vocab, {
    backed: backed(vocab),
    extend: [traverse(vocab)],
  })
  store.install()
  for (let s of ddl()) db.query(s)
  // ada writes and bea is assigned work, people the store knows; and the
  // store describes the components the journal's changes name, as a host
  // does at start.
  graph({ storage: store, vocab }).apply([
    { entity: { eid: 'ada' }, person: {} },
    { entity: { eid: 'bea' }, person: {} },
    ...['step', 'made', 'call'].map((name) => ({
      entity: { eid: '$' + name },
      _comp: { name },
    })),
  ], { trusted: true })
  let { g, settle } = process(db)
  let apply = async (b: Bundle[]) => {
    let out = await g.apply(b)
    await settle()
    return out
  }
  let read = async (q: string) => await g.read(whole(q))
  // A workflow holding these steps, each `{eid, ...step}`.
  let flow = (w: string, ...list: (Comp & { eid: string })[]) =>
    apply([
      { entity: { eid: w }, workflow: {}, doc: { title: w } },
      ...list.map(({ eid, ...step }) => ({ entity: { eid }, step })),
      ...list.map((s) => link(w, 'contains', s.eid)),
    ])
  return { db, g, store, apply, read, flow, settle }
}

// Step 1 calls a tool for each order; step 2 ships once the call is answered.
export let ask = {
  eid: 'ask',
  match: '$o .order',
  write: [{
    entity: { eid: '$c' },
    call: { name: 'pack', args: { order: '$o' } },
  }],
}
export let ship = {
  eid: 'ship',
  match:
    '$r .result, result.call=$c; $c .call, made.case=$k; $k .workflow_case, workflow_case.for=$o',
  write: [{ entity: { eid: '$s' }, shipment: { order: '$o' } }],
  when: 'write',
}
