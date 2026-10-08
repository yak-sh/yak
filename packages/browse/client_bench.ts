// Read-path baselines: the pure half that runs on every ws message.
import { rows } from './client.ts'
import { matchQuery, parseQuery } from './query.ts'
import { type Change, type Snapshot } from './types.ts'
import { standaloneMain } from '../../bench/standalone.ts'

if (import.meta.main) {
  await standaloneMain('web-client')
} else {
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
      { eid, name: 'task', comp: {} },
      { eid, name: 'filed', comp: { priority: i % 3 } },
    )
    if (i % 4 == 0) changes.push({ eid, name: 'completed', comp: {} })
    if (i < 5) changes.push({ eid, name: 'claim', comp: { session: S } })
  }
  let snap: Snapshot = { changes, deps: [] }
  let all = rows(snap)
  let ps = parseQuery('.task.status=open&.filed.priority<=1')

  Deno.bench('rows: 2k-task snapshot', () => {
    rows(snap)
  })

  Deno.bench('query: filter 2k rows (a board render)', () => {
    all.filter((r) => matchQuery(r.comps, ps))
  })

  // --- the client's own cache build (live.ts) ---------------------------------
  // What a browser tab and the TUI both pay between the socket's seed frame and
  // first paint: applyLocal folds the frame into the cache, then resetSignals
  // rebuilds the id index, the derived index and every partition in ONE pass
  // (D-18055 — the per-row maintenance during a seed was the dominant boot CPU).
  // A regression that re-introduces per-row indexing under a seed, or turns the
  // one index pass into a per-row one, shows up here as a multiple.
  //
  // The corpus is working-set sized (what workingSet() actually sends a cold
  // boot), not a whole graph.
  let { applyLocal, cache, resetSignals } = await import('./live.ts')

  let seed: Change[] = []
  for (let i = 0; i < 200; i++) {
    let eid = crypto.randomUUID()
    seed.push(
      { eid, name: 'entity', comp: { eid, num: 10_000 + i } },
      {
        eid,
        name: 'doc',
        comp: { title: `Seeded ${i}`, body: 'b'.repeat(120) },
      },
      { eid, name: 'task', comp: {} },
      { eid, name: 'filed', comp: { priority: i % 3 } },
    )
  }

  Deno.bench('applyLocal: fold a working-set seed into the cache', () => {
    cache.value = {}
    applyLocal(seed)
  })

  // The index rebuild a seed ends with — one pass over the whole cache.
  cache.value = {}
  applyLocal(seed)
  Deno.bench('resetSignals: rebuild every index from the cache', () => {
    resetSignals()
  })
}
