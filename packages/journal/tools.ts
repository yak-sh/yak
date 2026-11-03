// `@yaks/journal/tools` — what an agent may ask the log: the function behind
// the `history` declaration in ./vocab.json. One tool, because the log answers
// one question people actually ask: what happened to this, and who did it.
//
// The answer is bundles, and each bundle is the transaction: `applied()`
// rebuilds what a write committed out of the log's own record, so a history row
// has the same shape as the write that produced it — the components it patched,
// or `$delete` if it deleted the entity. Which transaction it was — its place in
// the log, when it committed, whom it acted for and through what — is carried on
// `_tx`, this package's own word for a committed transaction, so a row reads as
// the moment it was and draws as one (./views.ts).
//
// There is no `undo` tool here and no feed. Undo is `undo(g, j)` in ./undo.ts —
// a write, and one a server has to decide it offers — and a feed is a cursor a
// consumer holds, not a question anybody types.

import type { Bundle, Comp } from '@yaks/graph'
import { argsOf } from '@yaks/graph/call'
import { Refused } from '@yaks/graph/errors'
import type { Runs } from '@yaks/graph/tools'
import type { Batch } from './batch.ts'
import { applied } from './undo.ts'
import { type Bound, logFor } from './graph.ts'

// Which transaction it was: where it sits in the log, when it committed, whom
// it acted for and through what.
let stamp = (b: Batch): Comp => ({
  seq: b.seq,
  at: b.at,
  ...(b.by ? { by: b.by } : {}),
  ...(b.via ? { via: b.via } : {}),
})

// One committed transaction as the patch it applied to one entity, stamped. The
// log is cut to that entity first, so a transaction that also moved something
// else reports only this entity's part of it.
let said = (b: Batch): Bundle[] =>
  applied(b).map((patch) => ({ ...patch, _tx: stamp(b) }))

/** The functions behind the tools ./vocab.json declares — read over this
 * host's storage, which is why this export is a factory. */
export let runs = (host: Bound): Runs => {
  let j = logFor(host)
  return {
    history: (call): Bundle[] => {
      let args = argsOf(call)
      let asked = String(args.entity ?? '').trim()
      if (!asked) throw new Refused('history needs an entity')
      let n = args.limit == null ? undefined : Number(args.limit)
      // Newest first: a history is read back from where the entity got to.
      return j.history(asked, n).reverse().flatMap(said)
    },
  }
}
