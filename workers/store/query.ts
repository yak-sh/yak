// The /query door over a store: the query string IS the filter line — the
// grammar boards and task_list speak — and hits come back shaped like every
// entity JSON door. A port of src/server_runtime.ts's /query handler, the
// same riders (`id=` addresses, `backlinks=1`, `deps=1`, `quarantined=1`,
// `after=`/`limit=` paging, the aggregate projections) over the same db.ts
// readers, minus the two that reach outside the store: `work=` lanes (the
// server's graphIO) and `.order=similar` (the embedding provider), which are
// refused rather than guessed. The host seam should fold the server's copy and
// this one into one module; until then a change to one is a change to both.
import type { Sql } from '../../src/store/sql.ts'
import type { Dep } from '../../src/types.ts'
import { idOf } from '../../src/types.ts'
import {
  buried,
  depsOf,
  eager,
  locate,
  refsOf,
  rowsOf,
  textMatches,
} from '../../src/db.ts'
import { jsonOf, type Row } from '../../src/client.ts'
import {
  listed,
  matchQuery,
  orderOf,
  parseQuery,
  resolveRefs,
} from '../../src/query.ts'
import { evalAgg, evalGraph, rowed } from '../../src/graph_query.ts'
import { dbKids } from '../../src/subserve.ts'
import { withResults } from '../../src/result_component.ts'

let RIDERS = ['backlinks=1', 'deps=1', 'quarantined=1', 'recursive=1']
let PARAMS = ['after=', 'limit=', 'work=', 'id=']

export let query = (db: Sql, search: string): unknown => {
  let segs = search.slice(1).split('&').filter(Boolean).map(decodeURIComponent)
  let backs = segs.includes('backlinks=1')
  let edged = segs.includes('deps=1')
  let reveal = segs.includes('quarantined=1')
  let after = Number(segs.find((s) => s.startsWith('after='))?.slice(6)) || 0
  let limit = Number(segs.find((s) => s.startsWith('limit='))?.slice(6)) ||
    undefined
  if (segs.some((s) => s.startsWith('work='))) {
    throw new Error('work lanes are not served by this store')
  }
  // `id=` FETCHES rather than filters: each value is an ADDRESS, and an id
  // naming nothing is simply absent.
  let named = segs.filter((s) => s.startsWith('id='))
    .flatMap((s) => s.slice(3).split(',')).filter(Boolean)
  let only = named.length
    ? new Set(
      (named.map((i) => locate(db, i)).filter(Boolean) as string[])
        .filter((eid) => !buried(db, eid)),
    )
    : null
  segs = segs.filter((s) =>
    !RIDERS.includes(s) && !PARAMS.some((p) => s.startsWith(p))
  )
  let q = segs.join('&')
  let asked = q.trim() ? resolveRefs(parseQuery(q), (id) => locate(db, id)) : []
  if (orderOf(asked) == 'similar') {
    throw new Error('semantic ranking is not served by this store')
  }
  // An aggregate projection answers with the reduction, not a row set.
  let agg = evalAgg(db, q)
  if (agg) {
    if (agg.op == 'count') return { count: agg.values.get('') ?? 0 }
    let keys = [...agg.values.keys()].sort()
    return agg.op == 'distinct' ? { distinct: keys } : {
      tally: Object.fromEntries(keys.map((k) => [k, agg.values.get(k)])),
    }
  }
  let screen = (hits: Row[]) =>
    only ? hits.filter((r) => only.has(r.eid)) : hits
  // What a hit carries BESIDE its components: its own edges (deps=1) and who
  // points at it (backlinks=1), both keyed off the hits.
  let layers = (hits: Row[]) => {
    let eids = hits.map((r) => r.eid)
    if (!backs && !edged) return hits.map((r) => jsonOf(r))
    let deps = depsOf(db, eids).filter((d) =>
      reveal ||
      (!eager(db, d.parent).quarantined && !eager(db, d.child).quarantined)
    )
    let mine = new Map<string, Dep[]>()
    for (let d of deps) {
      for (let e of [d.parent, d.child]) {
        if (mine.has(e)) mine.get(e)!.push(d)
        else mine.set(e, [d])
      }
    }
    let back = new Map<string, { from: string; via: string; title: string }[]>()
    if (backs) {
      let wanted = new Set(eids)
      let refs = [
        ...refsOf(db, eids).filter((r) =>
          reveal || !eager(db, r.from).quarantined
        ),
        ...deps.filter((d) => wanted.has(d.child))
          .map((d) => ({ from: d.parent, via: d.type, to: d.child })),
      ]
      let titled = new Map(
        rowsOf(db, [...new Set(refs.map((r) => r.from))])
          .map(rowed).map((r) => [r.eid, r]),
      )
      for (let { from, via, to } of refs) {
        let r = titled.get(from)
        if (!r) continue // a comp row whose spine is gone names nobody
        let list = back.get(to) ?? []
        list.push({
          from: idOf(r),
          via,
          title: String(r.comps.doc?.title ?? ''),
        })
        back.set(to, list)
      }
    }
    return hits.map((r) => ({
      ...jsonOf(r),
      ...(edged ? { deps: mine.get(r.eid) ?? [] } : {}),
      ...(backs ? { backlinks: back.get(r.eid) ?? [] } : {}),
    }))
  }
  if (only) {
    // `id=` already SELECTED; a remaining filter only screens.
    let preds = asked
    let hits = withResults(
      db,
      preds,
      [...only].map((eid) => rowed({ eid, comps: eager(db, eid) })),
    )
      .filter((r) => reveal || listed(r.comps, preds))
      .filter((r) =>
        matchQuery(
          r.comps,
          preds,
          (e) => eager(db, e),
          undefined,
          dbKids(db, (e: string) => eager(db, e)),
          undefined,
          (eid, p) => textMatches(db, eid, p),
        )
      )
    return layers(screen(hits).sort((a, b) => a.num - b.num))
  }
  return layers(evalGraph(db, q, { after, limit }).hits)
}
