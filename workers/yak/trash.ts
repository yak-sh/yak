// The trash's date, stamped where the word is written rather than computed by
// whoever asked for it (T-34619). Deleting an app or a space writes ONE word on
// its row — `trashed` (erase.ts, T-34430/T-34431) — and the thirty days are
// counted off the `at` in it, so the ask and the clock were both the caller's:
// every door that trashes anything had to remember to date its own mark.
//
// It is a RULE instead: `*trashed, trashed.at=` says what it needs (a row
// wearing the word — the write set says so — with no date on it) and what it
// does about it (write one), while `#Actor, #Now` name the two singletons the
// tick hands it. The store that holds the row runs it in the `stamp` phase
// beside
// `created` and `updated` — which is what those two are as well (@yaks/graph
// rules.ts). So a caller asks for the trash by writing `trashed: {}`, the date
// and the byline are the store's exactly as a birth's are, and a mark that is
// already dated is left alone however often it is written again.
//
// The daily wake belongs here too: its `fired` write runs collection after
// the graph commits. erase.ts reaches the host modules, so the effect loads
// it when it runs, after the plugin list has been composed.
//
// `trashed` is the DIRECTORY's word (vocab.ts `platformDoc`), so this rule is
// inert in an app's store, which speaks no such component.
import type { Plugin } from './plugin.ts'
import type { Env } from './env.ts'
import { reporting } from './wake.ts'

/** The trash's calendar cadence; Cron Triggers only supply its heartbeat. */
export let DAILY = '20 4 * * *'

/**
 * The trash mark, dated and signed by the store: `at` is the batch's own
 * instant and `by` is whoever the platform vouched for — the two words the
 * `created` stamp writes, for the same reason. Each is the resource written
 * straight into the column it stands for, so a mark nobody signed is dated and
 * unsigned rather than dated and blank. A batch carrying its own `at` — a row
 * stood up in the past by a test, a mark a migration carries across — does not
 * match at all.
 */
export let trashPlugin: Plugin = {
  name: 'yak/trash',
  wakes: [{
    entity: { eid: 'yak-trash' },
    wake: { every: DAILY, note: 'Collect expired yaks.app trash' },
    sweep: { kind: 'trash' },
  }],
  rules: [{
    name: 'trashed',
    phase: 'stamp',
    match: '*trashed, trashed.at=, #Actor, #Now',
    run: ({ Actor, Now }) => ({ trashed: { at: Now, by: Actor } }),
  }, {
    name: 'trash',
    phase: 'effect',
    match: '.wake, *fired, .sweep, sweep.kind=trash, #Env, #Now',
    run: async ({ Env: env, Now }) => {
      if (!env) return
      return await reporting(env as unknown as Env, 'trash', async () => {
        let { collected } = await import('./erase.ts')
        await collected(env as unknown as Env, new Date(Now.at))
      })
    },
  }],
}
