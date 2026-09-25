// `@yaks/journal/tools` — what an agent may ask the log: the function behind
// the `history` declaration in ./vocab.json. One tool, because the log answers
// one question people actually ask: what happened to this, and who did it.
//
// The answer is bundles, and each bundle is the transaction: `applied()`
// rebuilds what a write committed out of the log's own record, so a history row
// has the same shape as the write that produced it — the components it patched,
// or `$delete` if it deleted the entity. Who wrote it is carried on
// `updated{at, by, via}`, a component this package neither declares nor
// imports: a tool returns data, so naming another package's component costs
// nothing, and a server whose vocabulary does not declare `updated` has those
// properties dropped when the bundles are admitted.
//
// There is no `undo` tool here and no feed. Undo is `undo(g, j)` in ./undo.ts —
// a write, and one a server has to decide it offers — and a feed is a cursor a
// consumer holds, not a question anybody types.

import { addressed, argsOf, type Bundle, type Comp, Refused } from '@yaks/graph'
import type { Runs } from '@yaks/graph/tools'
import type { Driver } from '@yaks/sql'
import type { Batch } from './batch.ts'
import { applied } from './undo.ts'
import { logFor } from './rules.ts'

// Who wrote the transaction, when, and through what — the same stamp a graph
// already carries for an entity's last write, reported here about a moment in
// the past.
let stamp = (b: Batch): Comp => ({
  at: b.at,
  ...(b.by ? { by: b.by } : {}),
  ...(b.via ? { via: b.via } : {}),
})

// One committed transaction as the patch it applied to one entity, stamped. The
// log is cut to that entity first, so a transaction that also moved something
// else reports only this entity's part of it.
let said = (b: Batch): Bundle[] =>
  applied(b).map((patch) => ({ ...patch, updated: stamp(b) }))

/** The functions behind the tools ./vocab.json declares — read over this
 * server's own connection, which is why this export is a factory. */
export let runs = (host: { sql: Driver }): Runs => {
  let j = logFor(host)
  return {
    history: async (call, graph): Promise<Bundle[]> => {
      let args = argsOf(call)
      let asked = String(args.entity ?? '').trim()
      if (!asked) throw new Refused('history needs an entity')
      let [eid] = await addressed(graph, [asked])
      let n = args.limit == null ? undefined : Number(args.limit)
      // Newest first: a history is read back from where the entity got to.
      return j.history(eid, n).reverse().flatMap(said)
    },
  }
}
