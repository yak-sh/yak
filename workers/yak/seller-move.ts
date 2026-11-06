// A space's connected account was `stripe{account, charges_enabled,
// details_submitted}` on its directory row, a word named for the one provider
// it came from (D-142123, question 2). It is `seller{via, account, ready,
// submitted}` now, `via` naming the provider, and this moves each space that
// still holds the old word. Every account held before the move was Stripe's.
//
// Expand, migrate, contract: the directory declares both words while this
// runs, every reader takes the old row as the new one (directory.ts `sellerOf`)
// and every writer writes the new one and clears the old (sell.ts `wrote`),
// so a space reads the same before, during and after its row moves. The old
// word, its reader and this rule go once the directory reports it moved.
import type { Bundle, Comp } from '@yaks/graph'
import { token } from '@yaks/graph/sha256'
import { PLATFORM_STORE } from './door.ts'
import type { Rule } from './mover.ts'

/** The `seller` row an old `stripe` row says, or null where it names no
 * account. */
export let fromStripe = (old: Comp | null | undefined) =>
  old?.account
    ? {
      via: 'stripe',
      account: String(old.account),
      ready: !!old.charges_enabled,
      submitted: !!old.details_submitted,
    }
    : null

/** The space's patch: the new row in place of the old, guarded on the old
 * row as it was read, so a writer that got there first wins. A row that
 * names no account held nothing to keep and is cleared. */
export let sellerMove = (row: Bundle): Bundle[] => {
  let old = row.stripe as Comp | undefined
  if (!old) return []
  let seller = fromStripe(old)
  return [{
    entity: { eid: row.entity.eid },
    ...(seller && !row.seller ? { seller } : {}),
    stripe: null,
    $was: {
      stripe: Object.fromEntries(
        ['account', 'charges_enabled', 'details_submitted']
          .map((prop) => [prop, token(old[prop])]),
      ),
    },
  }]
}

export let sellerRule: Rule = {
  mark: 'yak/store/seller/1',
  stores: [PLATFORM_STORE],
  find: '.stripe&*',
  move: sellerMove,
}
