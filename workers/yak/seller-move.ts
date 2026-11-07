// A space's connected account was `stripe{account, charges_enabled,
// details_submitted}` on its directory row, a word named for the one provider
// it came from (D-142123, question 2). It is `seller{via, account, ready,
// submitted}` now, `via` naming the provider, and this moves each space that
// still holds the old word, then sheds its columns. Every account held before
// the move was Stripe's.
//
// The release before this one read both words and wrote only the new, and its
// rehearsal found no old row in production's directory; so the old word is
// retired here, declared only for this rule's reads (`source`).
import type { Bundle, Comp } from '@yaks/graph'
import { token } from '@yaks/graph/sha256'
import type { VocabDoc } from '@yaks/vocab'
import { PLATFORM_STORE } from '@yaks/platform/names'
import { bool, owned, text } from './facets/schema.ts'
import type { Rule } from './mover.ts'

let OLD = ['account', 'charges_enabled', 'details_submitted']

/** The retired declaration, as the directory last said it. */
export let stripeSource: VocabDoc = {
  $defs: {
    stripe: {
      component: true,
      type: 'object',
      properties: {
        account: owned(text),
        charges_enabled: owned(bool),
        details_submitted: owned(bool),
      },
    },
  },
}

/** The space's patch: the new row in place of the old, guarded on the old
 * row as it was read, so a writer that got there first wins. A row that
 * names no account held nothing to keep and is cleared. */
export let sellerMove = (row: Bundle): Bundle[] => {
  let old = row.stripe as Comp | undefined
  if (!old) return []
  return [{
    entity: { eid: row.entity.eid },
    ...(old.account && !row.seller
      ? {
        seller: {
          via: 'stripe',
          account: String(old.account),
          ready: !!old.charges_enabled,
          submitted: !!old.details_submitted,
        },
      }
      : {}),
    stripe: null,
    $was: {
      stripe: Object.fromEntries(OLD.map((prop) => [prop, token(old[prop])])),
    },
  }]
}

export let sellerRule: Rule = {
  mark: 'yak/store/seller/1',
  stores: [PLATFORM_STORE],
  live: 'all',
  find: '.stripe&*',
  source: stripeSource,
  move: sellerMove,
  drop: OLD.map((prop) => `stripe.${prop}`),
}
