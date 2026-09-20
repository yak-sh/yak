// What an agent may ASK the log: the `tools` facet a host takes
// (`@yaks/journal/tools`) — the run behind the `entity_history` declaration in
// ./vocab.json. One tool, because the log answers one question a person asks
// out loud: what happened to this, and who did it.
//
// The answer is BUNDLES, and each bundle IS the batch: `applied()` rebuilds
// what a write committed out of the log's own record, so a history row has the
// same shape as the write that made it — the components it patched, or
// `$delete` for the death it was. Who wrote it rides on `updated{at, by, via}`,
// a word this package neither owns nor imports: a tool answers data, so naming
// a neighbour's component costs nothing, and a host that composes none has
// those columns dropped at the door.
//
// There is no `undo` here and no feed. Undo is `undo(g, j)` in ./undo.ts — a
// WRITE, and one a host has to decide it offers — and a feed is a cursor a
// consumer holds, not a question anybody types.

import {
  addressed,
  type Bundle,
  type Comp,
  Refused,
  type ToolCtx,
} from '@yaks/graph'
import type { Runs } from '@yaks/graph/tools'
import type { Driver } from '@yaks/sqlite'
import type { Batch } from './batch.ts'
import { applied } from './undo.ts'
import { logFor } from './rules.ts'

// Who wrote the batch, when, and through what — the stamp a graph already
// wears for its last write, said here about a moment in the past.
let stamp = (b: Batch): Comp => ({
  at: b.at,
  ...(b.by ? { by: b.by } : {}),
  ...(b.via ? { via: b.via } : {}),
})

// One committed batch as the patch it applied about one entity, stamped. The
// log is cut to the entity first, so a batch that also moved something else
// answers about this one alone.
let said = (b: Batch): Bundle[] =>
  applied(b).map((patch) => ({ ...patch, updated: stamp(b) }))

/** The runs behind the tools ./vocab.json declares — read over this host's own
 * connection, which is why the facet is a factory. */
export let runs = (host: { sql: Driver }): Runs => {
  let j = logFor(host)
  return {
    entity_history: async (_bundles, ctx: ToolCtx): Promise<Bundle[]> => {
      let asked = String(ctx.args.entity ?? '').trim()
      if (!asked) throw new Refused('entity_history needs an entity')
      let [eid] = await addressed(ctx.graph, [asked])
      let n = ctx.args.limit == null ? undefined : Number(ctx.args.limit)
      // Newest first: a history is read back from where the entity got to.
      return j.history(eid, n).reverse().flatMap(said)
    },
  }
}
