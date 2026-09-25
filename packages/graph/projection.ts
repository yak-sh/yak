// What a read answers, beside what it selects: the query grammar's projection
// (@yaks/query `*`, `?comp`). Jeff, 2026-09-03: "we should query for the
// exact components we want: `.book&?recipe` = must be book, recipe is
// optional but requested. asking for all comps is i imagine most useful for
// debugging". So a row carries the components the filter names — by presence
// (`.book`), by request (`?loan`), or by a predicate of its own — and nothing
// else. A filter that names none (an `.eid=` fetch, a bare search term) left
// nothing out and answers the whole bundle, which is also the only useful
// answer to someone who does not yet know what they found; `*` asks for
// everything by name.
//
// One rule for every door (T-38063): `Graph.read` answers it, and a
// subscription cuts the bundles a commit pushes the same way (@yaks/api
// subs.ts), so a page that swaps a query for a subscription gets the same rows.
// Storage answers whole entities; this is the graph's answer, not the
// adapter's.

import { parse } from '@yaks/query'
import type { Vocab } from '@yaks/vocab'
import type { Bundle } from './bundle.ts'
import type { Query } from './storage.ts'
import { meaning } from './meant.ts'

/** The components a meant query's rows carry, or `null` for every one of
 * them. A component asserted absent (`!archived`) names nothing the answer
 * could carry, and a word the vocabulary does not know asks for nothing. */
export let named = (vocab: Vocab, query: Query): Set<string> | null => {
  let { clauses } = typeof query == 'string' ? parse(query) : query
  if (clauses.some((c) => c.kind == 'every')) return null
  let want = new Set<string>()
  for (let c of clauses) {
    if (c.kind != 'pred' || !c.path.length) continue
    let absent = c.op == '=' &&
      (c.value == null || (c.value.kind == 'scalar' && !c.value.raw))
    if (absent) continue
    try {
      let comp = vocab.aim(c.path.join('.'), c.op == '!')[0]?.comp
      if (comp && comp != 'entity') want.add(comp)
    } catch { /* a word this graph never declared asks for nothing */ }
  }
  return want.size ? want : null
}

/** The same for a query as it was typed: a bare property counts for the
 * component it resolves to (./meant.ts). `Graph.read` has meant its query
 * already, so it asks {@link named}. */
export let wanted = (vocab: Vocab, query: Query): Set<string> | null =>
  named(vocab, meaning(vocab)(query))

/** A row cut to what was asked for. The spine names it, a text query's `rank`
 * is the answer's own word about it, and `$` keys are the graph's notes on
 * the row rather than components, so those ride whatever the filter said. */
export let only = (want: Set<string> | null) => (b: Bundle): Bundle =>
  !want ? b : Object.fromEntries(
    Object.entries(b).filter(([k]) =>
      k == 'entity' || k == 'rank' || k[0] == '$' || want.has(k)
    ),
  ) as Bundle
