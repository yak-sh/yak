// Read-path baselines: the pure half that runs on every ws message.
import { contextDigest, rows } from './client.ts'
import { matchQuery, parseQuery } from './query.ts'
import { type Change, type Snapshot } from './types.ts'

// Synthetic 2k-task snapshot, one session holding a handful of claims.
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
  if (i < 5) changes.push({ eid, name: 'claim', comp: { session_eid: S } })
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
