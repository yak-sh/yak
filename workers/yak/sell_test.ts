// Selling, at its seams (sell.ts, T-34523): the account we ask Stripe for, the
// fee arithmetic, the seller row derived off an account object, and the one
// word the page, the tool and the checkout door all read.
//
// The CONTROLLER PROPERTIES are pinned here in full, and that is the point of
// this file. They are four sentences about who is responsible for what — who
// pays Stripe's fee, who carries a lost dispute, who gets a dashboard, who
// collects the identity documents — and every one of them is a promise made to
// a seller on the terms page and a liability decision for the platform. A diff
// that moves one is a diff that has to say so out loud.
import { assertEquals } from '@std/assert'
import { moved } from './billing.ts'
import { account, fee, held, link, rate, sellerOf, selling } from './sell.ts'
import type { Space } from './directory.ts'

let space = (over: Partial<Space> = {}): Space => ({
  eid: 'e-space',
  slug: 'ada',
  title: 'Ada',
  tier: null,
  plan: null,
  stripe: null,
  meter: null,
  told: false,
  trashed: null,
  ...over,
})

Deno.test('the account is the charge-merchants-directly model, in full', () => {
  assertEquals(account(space(), 'ada@example.com'), {
    controller: {
      // The merchant pays Stripe's processing fee out of their own charge.
      fees: { payer: 'account' },
      // Stripe carries a lost dispute, not this platform.
      losses: { payments: 'stripe' },
      // The merchant reads their money in their OWN Stripe dashboard —
      // `full`, not `express`: Stripe refuses the cut-down one beside a
      // merchant who pays their own fees.
      stripe_dashboard: { type: 'full' },
      // Stripe collects the identity requirements. We never see one.
      requirement_collection: 'stripe',
    },
    email: 'ada@example.com',
    metadata: { space: 'e-space', slug: 'ada' },
  })
})

// Neither word is sent, and both absences are decisions. `capabilities` is
// required only for an account with no Stripe-hosted dashboard; ours have one,
// so Stripe requests the payment capabilities itself — and `transfers` is a
// destination charge's capability, which a direct charge never uses. `type` is
// the deprecated spelling of the four properties above, and the two ways of
// saying one thing are not both passed.
Deno.test('the account asks for no capabilities and names no type', () => {
  let made = account(space(), '') as Record<string, unknown>
  assertEquals('capabilities' in made, false)
  assertEquals('type' in made, false)
})

// An address we do not have is LEFT OUT rather than sent empty: an empty
// `email` is not the same ask as no email at all, and Stripe's form asks for
// one either way.
Deno.test('an account with no address for the seller sends none', () => {
  assertEquals('email' in account(space(), ''), false)
})

Deno.test('the onboarding link comes back to the space page, both ways', () => {
  assertEquals(link(space(), 'acct_1'), {
    account: 'acct_1',
    type: 'account_onboarding',
    return_url: 'https://ada.yaks.app/',
    refresh_url: 'https://ada.yaks.app/',
  })
})

Deno.test('the fee is basis points, rounded down, and never the whole sale', () => {
  // The owner has not set a rate, so nothing is taken.
  assertEquals(fee(10_000), 0)
  assertEquals(fee(1000, 250), 25)
  // Down, never up: the fee is never a cent more than the rate says.
  assertEquals(fee(999, 250), 24)
  assertEquals(fee(1, 250), 0)
  // Junk cannot make the platform take more than the sale, or take a negative.
  assertEquals(fee(1000, 1_000_000), 1000)
  assertEquals(fee(1000, -500), 0)
  assertEquals(fee(0, 250), 0)
})

Deno.test('the rate reads the way a person says it', () => {
  assertEquals(rate(0), '0%')
  assertEquals(rate(250), '2.5%')
  assertEquals(rate(1000), '10%')
})

Deno.test('the seller row is the account object, flags and all', () => {
  assertEquals(
    sellerOf({ id: 'acct_1', charges_enabled: true, details_submitted: true }),
    { account: 'acct_1', charges_enabled: true, details_submitted: true },
  )
  // A flag Stripe did not send is FALSE, not "unchanged": the account object
  // arrives whole on every `account.updated`, so an absent capability is an
  // absent capability — and a reader that guessed otherwise would leave a
  // seller marked ready after Stripe stopped them.
  assertEquals(sellerOf({ id: 'acct_1' }), {
    account: 'acct_1',
    charges_enabled: false,
    details_submitted: false,
  })
})

Deno.test('a redelivered account.updated moves no column at all', () => {
  let now = held(space({
    stripe: { account: 'acct_1', chargesEnabled: true, detailsSubmitted: true },
  }))
  let next = sellerOf({
    id: 'acct_1',
    charges_enabled: true,
    details_submitted: true,
  })
  assertEquals(moved(now, next), {})
  // And the one that DID change is the only column written.
  assertEquals(moved(now, { ...next, charges_enabled: false }), {
    charges_enabled: false,
  })
  // Nothing held yet: every column is new.
  assertEquals(moved(held(space()), next), next)
})

Deno.test('ready is charges_enabled and nothing else', () => {
  assertEquals(selling(space()), 'none')
  assertEquals(
    selling(space({
      stripe: {
        account: 'acct_1',
        chargesEnabled: false,
        detailsSubmitted: false,
      },
    })),
    'setup',
  )
  // The form is finished and Stripe is still verifying: NOT ready. Taking a
  // customer's money in that window is a payment that fails at the till.
  assertEquals(
    selling(space({
      stripe: {
        account: 'acct_1',
        chargesEnabled: false,
        detailsSubmitted: true,
      },
    })),
    'setup',
  )
  assertEquals(
    selling(space({
      stripe: {
        account: 'acct_1',
        chargesEnabled: true,
        detailsSubmitted: true,
      },
    })),
    'ready',
  )
})
