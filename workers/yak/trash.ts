// The trash's date, stamped where the word is written rather than computed by
// whoever asked for it (T-34619). Deleting an app or a space writes ONE word on
// its row — `trashed` (erase.ts, T-34430/T-34431) — and the thirty days are
// counted off the `at` in it, so the ask and the clock were both the caller's:
// every door that trashes anything had to remember to date its own mark.
//
// It is a RULE instead: `trashed, trashed.at=, *trashed` says what it needs (a
// row wearing the word with no date on it) and what it does about it (write
// one), and the store that holds the row runs it in the `stamp` phase beside
// `created` and `updated` — which is what those two are as well (@yaks/graph
// rules.ts). So a caller asks for the trash by writing `trashed: {}`, the date
// and the byline are the store's exactly as a birth's are, and a mark that is
// already dated is left alone however often it is written again.
//
// This is a FILE OF ITS OWN rather than a corner of erase.ts because the plugin
// list is one-way (plugins.ts): everything it imports is a domain, and erase.ts
// is a domain that reaches the host modules — the tool answers, the dispatch
// namespace, the store door. A rule needs none of them. What runs inside the
// store is here; what the Worker does about a delete stays there.
//
// `trashed` is the DIRECTORY's word (vocab.ts `platformDoc`), so this rule is
// inert in an app's store, which speaks no such component.
import type { Plugin } from './plugin.ts'

/**
 * The trash mark, dated and signed by the store: `at` is the batch's own
 * instant and `by` is whoever the platform vouched for — the two words the
 * `created` stamp writes, for the same reason. A batch carrying its own `at` —
 * a row stood up in the past by a test, a mark a migration carries across —
 * does not match at all.
 */
export let trashPlugin: Plugin = {
  name: 'yak/trash',
  rules: [{
    name: 'trashed',
    phase: 'stamp',
    match: 'trashed, trashed.at=, *trashed',
    run: (_bound, ctx) => ({
      trashed: { at: ctx.now, ...(ctx.actor.by ? { by: ctx.actor.by } : {}) },
    }),
  }],
}
