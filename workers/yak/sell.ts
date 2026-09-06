// Selling through yaks.app (T-34523): a space connects its own Stripe account
// and its apps take money on it, with the platform taking a fee on the way
// past. Jeff configured Connect on our sandbox with the "charge merchants
// directly" model, and every decision below follows from that one choice.
//
// DIRECT CHARGES, and what that means for every line here. The connected
// account is the MERCHANT: the charge is on their books, Stripe's processing
// fee comes out of their money, the customer's statement says their name, and
// a refund or a dispute is theirs to answer and theirs to pay. We are not in
// the middle of it. What we do is act on their account with our own platform
// key — one `Stripe-Account` header (billing.ts `ask`) — and name an
// `application_fee_amount` that Stripe moves to us out of the same payment.
//
// So the platform holds THREE FACTS about a seller and no more (vocab.ts
// `stripe` on the space row): the `acct_…` id, whether Stripe says charges are
// enabled, and whether they finished the form. Their bank details, their
// balance, their payouts and their disputes live at Stripe, where they belong,
// and the seller reads them in Stripe's own dashboard. A platform that copied
// them would be a platform holding money data it does not need and cannot keep
// current.
//
// This is a DIFFERENT relationship from billing.ts, which is the platform's own
// plan: there Stripe sells to us and we are the customer. Nothing crosses
// between them — a different account object, a different webhook endpoint, a
// different signing secret — and the two share exactly one thing, the request
// helper and the signature verifier, because Stripe's API is Stripe's API.
//
// v1 THROUGHOUT, deliberately (Jeff, 2026-09-06, on the endpoint he was
// creating: "v1"). `POST /v1/accounts` with controller properties, and the v1
// event names. There is a v2 Accounts API with its own thin `v2.core.*`
// events; mixing the two would mean a handler reading one spelling and a
// dashboard ticking the other, which is a webhook that silently does nothing.
//
// NOTHING HERE MAY FAIL QUIETLY, the same rule billing.ts keeps: a break is an
// exception entity in the meta store, a refusal is a sentence the person reads,
// and the webhook's filing is capped so a stranger posting garbage at a public
// door cannot write rows without end.
import { ask, broke, moved, verified } from './billing.ts'
import * as dirPart from './directory.ts'
import { directory, type Space, stamp } from './directory.ts'
import { bound, type Env } from './env.ts'
import { PLATFORM } from './route.ts'

// ---- the fee ---------------------------------------------------------------

/**
 * What the platform takes from one sale, in BASIS POINTS — hundredths of a
 * percent, so 250 is 2.5%. THE OWNER SETS THIS NUMBER; it is 0 until he does,
 * which means every sale goes to the seller whole and nothing is taken. Zero is
 * the honest default: a fee nobody chose, charged to somebody's customer, is
 * worse than no fee at all.
 *
 * It is one constant because it is said in four places — the Checkout Session's
 * `application_fee_amount`, the pricing page, the terms, and the sentence
 * `space_sell` answers with — and four copies of a number drift the first time
 * one moves. site_test.ts holds the two pages to this line, the way it holds
 * them to `PRICE` (meter.ts), so a change is this number and nothing else.
 */
export let FEE_BPS = 0

/** The fee on a total, in cents. Rounded DOWN, so the fee is never a cent more
 * than the rate says, and never more than the sale itself.
 *
 * ```ts
 * fee(1000, 250) // 25
 * fee(999, 250)  // 24 — down, not up
 * fee(1000, 0)   // 0
 * ```
 */
export let fee = (cents: number, bps = FEE_BPS) =>
  Math.min(cents, Math.max(0, Math.floor((cents * bps) / 10_000)))

/** The rate as a person reads it: `2.5%`, or `0%`. One derivation, so the
 * pages and the tool sentence cannot disagree with the arithmetic above. */
export let rate = (bps = FEE_BPS) => `${Math.round(bps / 100 * 100) / 100}%`

// ---- the connected account -------------------------------------------------

/**
 * The account we ask Stripe for, as the form fields of `POST /v1/accounts`.
 *
 * THE CONTROLLER PROPERTIES ARE THE WHOLE MODEL. "Charge merchants directly"
 * is these four answers, and each is a sentence about who is responsible for
 * what. They are also, all four, Stripe's own DEFAULTS — the combination it
 * documents as the Standard mapping
 * (docs.stripe.com/connect/migrate-to-controller-properties). They are written
 * out anyway, because a liability decision that four omitted parameters happen
 * to make is a liability decision nobody can read, and a default Stripe moves
 * one day would move it silently.
 *
 *   `controller[fees][payer] = account`
 *       the CONNECTED ACCOUNT pays Stripe's processing fee, out of its own
 *       money, on its own charge. Not us — we are not reselling payments.
 *   `controller[losses][payments] = stripe`
 *       STRIPE, not this platform, carries the negative balance when a dispute
 *       is lost. There is no `account` value here and the spelling is not a
 *       mistake: `stripe` is what "the platform is not liable" is called, and
 *       the merchant is still the one whose charge is reversed.
 *   `controller[stripe_dashboard][type] = full`
 *       the seller gets the whole Stripe Dashboard, their own account, where
 *       they read their payments, answer their disputes and manage their
 *       payouts. `express` is the cut-down one, and Stripe refuses it beside
 *       `fees.payer = account`: an Express dashboard is for a platform that
 *       pays the fees and carries the losses, which is the opposite of this.
 *   `controller[requirement_collection] = stripe`
 *       STRIPE collects and re-collects the identity requirements, through the
 *       Account Link below. The platform never sees, stores or forwards a
 *       seller's identity documents, which is exactly the property that lets
 *       this integration exist without us becoming a KYC operator.
 *
 * NO `capabilities`, deliberately. Stripe requires them only where the account
 * has no Stripe-hosted dashboard; with `full` the payment capabilities are
 * requested automatically for the account's country, and the seller manages
 * them themselves. `transfers` in particular would be wrong — that is the
 * capability a DESTINATION charge needs, and a direct charge never transfers.
 *
 * NO `type` either. It is deprecated in favour of exactly these four
 * properties, and the two ways of saying one thing are not passed together.
 *
 * `metadata` carries the space both ways, so an account read back out of
 * Stripe's dashboard says whose it is without a lookup here.
 */
export let account = (space: Space, email: string) => ({
  controller: {
    fees: { payer: 'account' },
    losses: { payments: 'stripe' },
    stripe_dashboard: { type: 'full' },
    requirement_collection: 'stripe',
  },
  ...(email ? { email } : {}),
  metadata: { space: space.eid, slug: space.slug },
})

/** Where onboarding hands somebody back: the space's own page, both ways.
 *
 * `return_url` is where Stripe sends them when they finish, and `refresh_url`
 * is where it sends them when the link is spent — an Account Link is
 * SINGLE-USE and expires in about five minutes, since it is an authenticated
 * door into somebody's identity form. Stripe's own instruction for
 * `refresh_url` is "generate a new account link with the same parameters, then
 * redirect", and the space page's "Start selling" button is precisely that, so
 * both URLs are that page.
 *
 * It is also the right place for `return_url`: the page reads `stripe` off the
 * space and says not connected, finishing setup, or ready. A landing page of
 * its own would have to say the same three things and could only say them less
 * currently — Stripe returns the browser the moment the form is submitted,
 * which is before `account.updated` has necessarily arrived. */
export let backTo = (space: Space) => `https://${space.slug}.${PLATFORM}/`

/** The onboarding link, as the form fields of `POST /v1/account_links`.
 *
 * `account_onboarding` and never `account_update`: Stripe refuses an update
 * link for an account that has its own dashboard, and ours all do. A seller
 * changing their details later does it in their own Stripe Dashboard, which is
 * the whole point of giving them one. */
export let link = (space: Space, id: string) => ({
  account: id,
  type: 'account_onboarding',
  return_url: backTo(space),
  refresh_url: backTo(space),
})

// ---- what the platform writes down about a seller ---------------------------

/** The `stripe` row a Stripe account object makes: the id, and the two words
 * Stripe answers with. Every writer here ends at this — an account just
 * created, an `account.updated` event, a seller who deauthorized us — so there
 * is one derivation of the row and no state machine.
 *
 * A missing field reads FALSE rather than "unchanged". Stripe sends the whole
 * account object on every `account.updated`, so an absent flag is an absent
 * capability, and a reader that treated it as unchanged would leave a seller
 * marked ready after Stripe stopped them. */
export let sellerOf = (a: Account) => ({
  account: String(a.id ?? ''),
  charges_enabled: !!a.charges_enabled,
  details_submitted: !!a.details_submitted,
})

/** The slice of a Stripe account this reads. Optional throughout: the shape is
 * Stripe's to move, and a field that went missing must leave a readable row
 * rather than a throw in the middle of somebody's onboarding. */
export type Account = {
  id?: string
  charges_enabled?: boolean
  details_submitted?: boolean
  payouts_enabled?: boolean
}

/** The seller's row as the directory holds it, for billing.ts's `moved` to
 * compare
 * against — the same three columns, in the vocabulary's own spelling. */
export let held = (space: Space) =>
  space.stripe
    ? {
      account: space.stripe.account,
      charges_enabled: space.stripe.chargesEnabled,
      details_submitted: space.stripe.detailsSubmitted,
    }
    : null

/** Where a space stands with selling, as one word — what the page, the tool and
 * the checkout door's refusal all read.
 *
 * `ready` is `charges_enabled` and nothing else. Not `details_submitted`: a
 * seller can finish the form and still be held while Stripe verifies them, and
 * taking somebody's customer's money in that window is a payment that fails at
 * the till. */
export let selling = (space: Space): 'none' | 'setup' | 'ready' =>
  !space.stripe?.account
    ? 'none'
    : space.stripe.chargesEnabled
    ? 'ready'
    : 'setup'

// ---- connecting ------------------------------------------------------------

let dirOf = (env: Env) =>
  directory(bound(env.DIRECTORY, dirPart.fetch, env), true)

/** The space's `stripe` row, written through the kernel's own door — every
 * column of it is server-owned (vocab.ts), so this is the only writer. */
let wrote = (env: Env, space: Space, row: Record<string, unknown> | null) =>
  stamp(env, { entities: [{ entity: { eid: space.eid }, stripe: row }] })

/**
 * Connect this space to a Stripe account, and answer the link that finishes it.
 *
 * The account is minted ONCE and kept: a space that starts onboarding, wanders
 * off and comes back a week later gets a new LINK onto the same account, never
 * a second account — two accounts for one space would be a merchant whose
 * money is split across books nobody can add up. So the id is written the
 * moment Stripe answers with it, before the link is asked for, and the second
 * call finds it.
 *
 * The link is minted fresh every time, because it is single-use and expires.
 */
export let connect = async (env: Env, space: Space, email: string) => {
  let id = space.stripe?.account
  if (!id) {
    let made = await ask(env, '/v1/accounts', account(space, email)) as Account
    id = String(made.id ?? '')
    if (!id) throw new Error('stripe made an account with no id')
    let row = sellerOf(made)
    await wrote(env, space, row)
    space.stripe = {
      account: row.account,
      chargesEnabled: row.charges_enabled,
      detailsSubmitted: row.details_submitted,
    }
  }
  let made = await ask(env, '/v1/account_links', link(space, id))
  let url = String(made.url ?? '')
  if (!url) throw new Error('stripe made an account link with no url')
  return { account: id, url }
}

/**
 * Stop selling: the platform FORGETS the account, and Stripe keeps it.
 *
 * Deliberately not a delete. The account is the merchant's own — their money,
 * their payouts, their records of every sale they have made, and Stripe's own
 * rules about what may be closed and when. Ours to forget, never ours to
 * destroy. What this does is take the row off the space, so no app here can
 * create another charge on it; the seller's dashboard, balance and history are
 * exactly where they were, and connecting again is one call.
 */
export let disconnect = (env: Env, space: Space) => wrote(env, space, null)

// ---- the Connect webhook ---------------------------------------------------

/**
 * An event as it arrives from a CONNECTED account. The `account` field is the
 * whole difference from billing.ts's Event: an event delivered to a Connect
 * endpoint names the `acct_…` it happened on, and that is what turns it back
 * into a space (`dir.seller`). An event with no `account` on this door is one
 * of the platform's own that took a wrong turn, and it is nothing to do here.
 */
export type Event = {
  id?: string
  type?: string
  account?: string
  created?: number
  data?: { object?: Record<string, unknown> }
}

/**
 * One verified event, applied. Answers what it did, which is what the door says
 * back — Stripe ignores the body, and a person reading the logs does not.
 *
 * The five v1 events this platform listens for, and why each:
 *   `account.updated`                   Stripe changed its mind about a seller
 *   `account.application.deauthorized`  a seller disconnected US, from their
 *                                       own dashboard — the one direction we
 *                                       cannot learn about any other way
 *   `checkout.session.completed`        somebody bought something (T-34526)
 *   `charge.refunded`                   the seller refunded it (T-34526)
 *   `charge.dispute.created`            the buyer disputed it (T-34526)
 */
export let apply = async (env: Env, event: Event): Promise<string> => {
  let type = event.type ?? ''
  let on = event.account ?? ''
  if (!on) return 'not a connected account event'
  let dir = dirOf(env)
  let space = await dir.seller(on)
  // An account we have no space for: a seller who disconnected, or another
  // platform's event at our door. Nothing to retry — a second delivery finds
  // the same nothing — so it is not filed and the door answers 200 rather than
  // making Stripe repeat an unanswerable question for three days.
  if (!space) return 'no space sells through that account'
  if (type == 'account.updated') {
    let next = sellerOf(event.data?.object as Account ?? {})
    // The id comes from the row we already hold, never from the payload: the
    // event was ATTRIBUTED by that id, and an account object that answered a
    // different one would be Stripe telling us the account changed identity.
    next.account = on
    let changed = moved(held(space), next)
    if (!Object.keys(changed).length) return 'unchanged'
    await wrote(env, space, changed)
    return `${space.slug} ${next.charges_enabled ? 'can' : 'cannot'} sell`
  }
  // The seller revoked us from their own Stripe dashboard. The account still
  // exists and is still theirs; what ended is our permission to act on it, so
  // the row comes off the space exactly the way `space_sell(disconnect: true)`
  // takes it off. Anything else would leave the space looking ready to sell
  // through an account that would refuse the next charge.
  if (type == 'account.application.deauthorized') {
    await disconnect(env, space)
    return `${space.slug} disconnected`
  }
  return 'nothing to do'
}

// The webhook door is on the open internet, so what it FILES has a ceiling:
// per isolate, per minute, the way billing.ts caps its own. A refused signature
// is worth seeing once — a secret rolled, or somebody poking — and worth seeing
// a hundred times an hour never.
let FILED = 6
let filed = new Map<string, { minute: number; n: number }>()

let hushed = (what: string) => {
  let minute = Math.floor(Date.now() / 60_000)
  let hit = filed.get(what)
  if (!hit || hit.minute != minute) {
    filed.set(what, { minute, n: 1 })
    return false
  }
  return ++hit.n > FILED
}

let json = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message } }, { status })

/**
 * Stripe's Connect door, at `https://yaks.app/stripe/connect`. Its OWN endpoint
 * with its OWN signing secret, because that is how Stripe delivers connected-
 * account events: the platform's endpoint (billing.ts) hears about our
 * subscription, and this one hears about our sellers. Two endpoints, two
 * `whsec_…`, and a secret that verified the wrong one is a door that answers
 * nothing.
 *
 * The body is read as TEXT once and verified as that exact string: the
 * signature covers the raw bytes, so parsing and re-serializing would verify
 * something Stripe never signed. The scheme is identical to the platform
 * endpoint's, which is why the verifier is billing.ts's and not a second copy.
 *
 * UNTIL THE SECRET IS SET this answers 503 in one sentence, and everything else
 * about selling still works: a space connects, a checkout session is created, a
 * buyer pays. What is missing is only what the events would have told us —
 * whether the seller became ready, and the order row. That is deliberate: the
 * secret is the owner's to set (README.md), and half a feature that says so is
 * better than a door that pretends.
 */
let hook = async (env: Env, req: Request) => {
  if (req.method != 'POST') {
    return json(405, 'method_not_allowed', 'post the event here')
  }
  let raw = await req.text()
  if (!env.STRIPE_CONNECT_WEBHOOK_SECRET) {
    if (!hushed('unset')) {
      await broke(
        env,
        'POST /stripe/connect',
        new Error(
          'STRIPE_CONNECT_WEBHOOK_SECRET is not set — an event went unread',
        ),
      )
    }
    return json(503, 'no_selling', 'this door is not switched on here yet')
  }
  let no = await verified(
    raw,
    req.headers.get('stripe-signature'),
    env.STRIPE_CONNECT_WEBHOOK_SECRET,
  )
  if (no) {
    if (!hushed(no)) await broke(env, 'POST /stripe/connect', new Error(no))
    return json(400, 'bad_signature', no)
  }
  let event: Event
  try {
    event = JSON.parse(raw) as Event
  } catch {
    return json(400, 'bad_event', 'that was not an event')
  }
  // A failure past this line is OURS, so it throws: index.ts files it and
  // answers a 5xx, and Stripe delivers again. That is exactly what we want for
  // a store that was busy or a Stripe call that timed out.
  return Response.json({ received: true, did: await apply(env, event) })
}

export let fetch = (req: Request, env: Env): Promise<Response> => hook(env, req)
