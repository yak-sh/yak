// The /query door over a store: the query string IS the filter line — the
// grammar boards and task_list speak — and hits come back shaped like every
// entity JSON door. The DOOR is graph_query.ts (askOf → askRows → layered), the
// same one src/server_runtime.ts's route and the CLI's local arm read; this
// module is the store's adapter to it, and carries only what a Cloudflare store
// cannot serve: `work=` lanes (the server's graphIO) and `.order=similar` (the
// embedding provider), refused rather than guessed.
//
// It was a PORT of the server's handler, and the copy drifted exactly as a copy
// does — the per-id hydration fix that landed twice on the other two doors
// (0d4d4b4a, 2f0b8ed7) never reached this one at all, so a `id=` fetch here
// still paid a statement per component per entity. There is one implementation
// now, and a fix to any arm is a fix to every store.
import type { Sql } from '../../src/store/sql.ts'
import { locate } from '../../src/db.ts'
import { orderOf, parseQuery, resolveRefs } from '../../src/query.ts'
import { askOf, askRows, evalAgg, layered } from '../../src/graph_query.ts'

export let query = async (db: Sql, search: string): Promise<unknown> => {
  let segs = search.slice(1).split('&').filter(Boolean).map(decodeURIComponent)
  let ask = askOf(segs)
  if (ask.work) throw new Error('work lanes are not served by this store')
  let q = ask.filters.join('&')
  // The refusal is this store's, not the door's: askRows would decline a
  // similarity order too (no ranker is registered here, since embed.ts's vector
  // backend cannot ride a worker bundle), but it says so in the app plane's
  // words. A store that cannot serve a capability names itself.
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
  return layered(db, await askRows(db, ask), ask)
}
