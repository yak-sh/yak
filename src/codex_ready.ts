// The codex readiness gate: signed in AND the Responses bus answers. "Signed
// in" alone (account.status) left a box with valid creds but an unreachable or
// wedged bus in the dispatch rotation, where every generation it drew stalled
// behind a live claim with no error (T-24135). The bus probe (transport.reach)
// is bounded, and its verdict is held briefly so the per-minute dispatch sweep
// and the per-spawn obey door don't each pay a network round trip.
import type { AccountStatus } from './accounts.ts'

export let codexReadiness = (
  status: () => Promise<AccountStatus>,
  reach: () => Promise<boolean>,
  ttlMs = 15_000,
  clock: () => number = Date.now,
) => {
  let at = 0
  let held: Promise<boolean> | undefined
  let probe = () => {
    let now = clock()
    if (!held || now - at > ttlMs) {
      at = now
      held = reach().catch(() => false)
    }
    return held
  }
  // The signed-in read is local and already cached in the account service, so it
  // gates every call; the bus round trip only runs when signed in, never when
  // the answer is already no.
  return async () => {
    let signedIn = await status().then((s) => s.ready).catch(() => false)
    return signedIn ? probe() : false
  }
}
