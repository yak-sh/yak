// Read-path baselines: the pure half that runs on every ws message.
import { contextDigest, rows } from './client.ts'
import { matchQuery, parseQuery } from './query.ts'
import { type Change, type Snapshot } from './types.ts'

// Synthetic 2k-task snapshot, one session holding a handful of claims. This is
// the open-board arm of the digest — the session has no actor, so the
// narrative-memory helpers stay quiet and the cost is the whole-graph filter
// passes plus the per-shown-task block.
let S = crypto.randomUUID()
let changes: Change[] = [
  { eid: S, name: 'entity', comp: { eid: S, num: 1 } },
  { eid: S, name: 'session', comp: { id: 'sess-bench' } },
]
for (let i = 0; i < 2000; i++) {
  let eid = crypto.randomUUID()
  changes.push(
    { eid, name: 'entity', comp: { eid, num: i + 2 } },
    { eid, name: 'doc', comp: { title: `Task ${i}`, body: 'b'.repeat(200) } },
    {
      eid,
      name: 'task',
      comp: { status: i % 4 ? 'open' : 'done', priority: i % 3 },
    },
  )
  if (i < 5) changes.push({ eid, name: 'claim', comp: { session: S } })
}
let snap: Snapshot = { changes, deps: [] }
let all = rows(snap)
let ps = parseQuery('.status=open&.priority<=1')

Deno.bench('rows: 2k-task snapshot', () => {
  rows(snap)
})

Deno.bench('query: filter 2k rows (a board render)', () => {
  all.filter((r) => matchQuery(r.comps, ps))
})

Deno.bench('contextDigest: 2k-task graph', () => {
  contextDigest(snap, 'sess-bench')
})

// The SAME 2k board, but the session carries an actor with wrapped sibling
// sessions and comments — so the narrative helpers (unheard, previously,
// resume, onMine) all RUN. Without this the digest bench measured only the
// open-board arm and hid unheard's per-session nested comment scan; this corpus
// makes a reintroduced whole-graph scan there a visible regression.
let recent = new Date(Date.now() - 3600_000).toISOString()
let AS = crypto.randomUUID()
let aTasks: string[] = []
let aCh: Change[] = [
  { eid: AS, name: 'entity', comp: { eid: AS, num: 1 } },
  { eid: AS, name: 'created', comp: { at: recent } },
  {
    eid: AS,
    name: 'session',
    comp: { id: 'sess-actor', actor: 'bench-actor', cwd: '/bench' },
  },
]
for (let i = 0; i < 2000; i++) {
  let eid = crypto.randomUUID()
  aTasks.push(eid)
  // Only a realistic handful are the actor's own work — most of the board
  // belongs to others, as on the live graph.
  let by = i < 20 ? 'bench-actor' : 'other'
  aCh.push(
    { eid, name: 'entity', comp: { eid, num: i + 2 } },
    { eid, name: 'created', comp: { at: recent, by } },
    { eid, name: 'doc', comp: { title: `Task ${i}`, body: 'b'.repeat(200) } },
    {
      eid,
      name: 'task',
      comp: { status: i % 4 ? 'open' : 'done', priority: i % 3 },
    },
  )
  if (i < 5) aCh.push({ eid, name: 'claim', comp: { session: AS } })
}
let aSibs: string[] = []
for (let i = 0; i < 10; i++) {
  let eid = crypto.randomUUID()
  aSibs.push(eid)
  aCh.push(
    { eid, name: 'entity', comp: { eid, num: 3000 + i } },
    { eid, name: 'created', comp: { at: recent } },
    { eid, name: 'updated', comp: { at: recent } },
    { eid, name: 'session', comp: { id: `sib-${i}`, actor: 'bench-actor' } },
    { eid, name: 'doc', comp: { title: `Sibling ${i}`, body: 'brief line' } },
    { eid, name: 'brief', comp: {} },
  )
}
for (let i = 0; i < 50; i++) {
  let eid = crypto.randomUUID()
  let target = i % 2 ? aTasks[i % 5] : aSibs[i % aSibs.length]
  aCh.push(
    { eid, name: 'entity', comp: { eid, num: 4000 + i } },
    { eid, name: 'created', comp: { at: recent, by: 'someone-else' } },
    { eid, name: 'doc', comp: { title: '', body: `comment ${i}` } },
    { eid, name: 'comment', comp: { target } },
  )
}
let aSnap: Snapshot = { changes: aCh, deps: [] }

Deno.bench('contextDigest: 2k graph, actor path', () => {
  contextDigest(aSnap, 'sess-actor')
})
