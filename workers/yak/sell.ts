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
import { sha256 } from '@yaks/graph'
import { ask, broke, moved, verified } from './billing.ts'
import * as dirPart from './directory.ts'
import {
  type App,
  appStore,
  directory,
  type Space,
  stamp,
} from './directory.ts'
import { bound, type Env } from './env.ts'
import { metaOf } from './meta.ts'
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

// ---- the checkout door -----------------------------------------------------
//
// `POST /<app>/api/pay/checkout` (apps.ts): a cart in, a Stripe address out.
// The whole reason it is the PLATFORM's door and not something an app writes is
// that it is the only place the platform key is spent — an app holds no Stripe
// key, writes no worker, and cannot charge anybody a penny it did not ask for.
//
// NOTHING ABOUT MONEY COMES OFF THE WIRE. The caller names a product and how
// many; the price is read off that product's own row in the app's store. A page
// that posted a price would be a page a buyer can edit with the developer
// tools, and the first person to try it would buy a shirt for a cent.

/** One line of a cart, as a page or a worker posts it. `options` is a variant
 * the seller offers — a size, a colour — appended to the name the buyer reads
 * on Stripe's page, and kept on the order so the seller knows what to put in
 * the box. */
export type Item = { product: string; qty: number; options?: string }

/** The cart, read off a request body. Throws the sentence the caller reads:
 * this is the door a guest reaches, so a refusal has to say what to fix. */
export let cart = (body: unknown): Item[] => {
  let items = (body as { items?: unknown })?.items
  if (!Array.isArray(items) || !items.length) {
    throw new Error('items: a list of {product, qty} to sell, and not empty')
  }
  return items.map((one, i) => {
    let it = one as Record<string, unknown>
    let product = String(it?.product ?? '')
    if (!product) throw new Error(`items[${i}].product: name a product`)
    let qty = Math.floor(Number(it?.qty ?? 1))
    if (!(qty > 0)) throw new Error(`items[${i}].qty: how many, at least one`)
    let options = String(it?.options ?? '').trim().slice(0, 60)
    return { product, qty, ...(options ? { options } : {}) }
  })
}

/** A product row, as the store answers it. */
export type Product = {
  entity: { eid: string }
  doc?: { title?: string | null }
  product?: { price_cents?: number | null }
}

/**
 * Stripe's metadata takes 500 characters per value, and the order's items ride
 * one of them — so this is how many lines fit in an order, and the door refuses
 * a bigger cart by name rather than sending Stripe something it will truncate.
 * A uuid with its dashes off is 32 characters and a line is about 45, so it
 * lands near ten.
 */
export let META = 500

/** The items as they ride to Stripe and come back on the event: the product,
 * how many, and the variant, at the shortest spelling that survives a round
 * trip. Dashes come off the uuid to buy back four characters a line. */
export let packed = (items: Item[]) =>
  JSON.stringify(
    items.map((i) => ({
      p: i.product.replace(/-/g, ''),
      q: i.qty,
      ...(i.options ? { o: i.options } : {}),
    })),
  )

/**
 * The cart priced against the store's own rows: Stripe's `line_items`, the
 * total in cents, and the items packed for the metadata.
 *
 * Every refusal here happens BEFORE Stripe is asked, and each says which line
 * is wrong: a product this store does not have (an eid off another app, or one
 * somebody made up), and a product with no price, which is a seller's row that
 * is not finished rather than a free shirt.
 */
export let priced = (rows: Product[], items: Item[]) => {
  let by = new Map(rows.map((r) => [r.entity.eid, r]))
  let total = 0
  let lines = items.map((one) => {
    let row = by.get(one.product)
    if (!row?.product) throw new Error(`no product ${one.product} in this app`)
    let cents = Math.floor(Number(row.product.price_cents ?? 0))
    if (!(cents > 0)) {
      throw new Error(`${row.doc?.title || one.product} has no price`)
    }
    let name = row.doc?.title || 'Item'
    total += cents * one.qty
    return {
      price_data: {
        currency: 'usd',
        product_data: { name: one.options ? `${name} (${one.options})` : name },
        unit_amount: cents,
      },
      quantity: one.qty,
    }
  })
  let meta = packed(items)
  if (meta.length > META) {
    throw new Error(
      `that is too many different things in one order — about ` +
        `${Math.floor(items.length * META / meta.length)} lines fit`,
    )
  }
  return { lines, total, packed: meta }
}

/**
 * Where Stripe sends the buyer, from what the caller asked for. RELATIVE to the
 * app's own root, always — so nothing in a page spells the app's name and an
 * installed copy sends its buyers back to itself.
 *
 * And it may not leave that root. This door is callable by a GUEST on an open
 * app, so an absolute URL from the wire would let a stranger have yaks.app's
 * own checkout hand buyers to a page they wrote. `new URL(asked, root)` resolves
 * the ordinary relative case and swallows the absolute one, so what is checked
 * is the ANSWER rather than the input — a filter over the input would be a list
 * of the escapes somebody thought of.
 *
 * The braces come back afterwards, and only those two characters.
 * `{CHECKOUT_SESSION_ID}` is a literal Stripe substitutes the session id for on
 * the way back, `new URL` percent-encodes braces in a query, and
 * `%7BCHECKOUT_SESSION_ID%7D` is a string Stripe does not recognise — so the
 * buyer would land on a page that never learns which order it is about. Undone
 * AFTER the check, so nothing about where this points has been decided by it.
 */
export let backAt = (root: string, asked: unknown) => {
  let at = String(asked ?? '').trim()
  if (!at) return root
  let out: URL
  try {
    out = new URL(at, root)
  } catch {
    throw new Error(`${at} is not an address`)
  }
  if (!out.href.startsWith(root)) {
    throw new Error(`success and cancel stay inside this app (${root})`)
  }
  return out.href.replaceAll('%7B', '{').replaceAll('%7D', '}')
}

/**
 * The Checkout Session, as the form fields of `POST /v1/checkout/sessions` —
 * created ON the seller's account (the `Stripe-Account` header, which the
 * caller adds).
 *
 * `payment_intent_data[application_fee_amount]` is the platform's cut, and it
 * is the ONLY place Stripe takes one for a Checkout Session — there is no
 * top-level spelling. It is left out entirely when it is zero: Stripe requires a
 * positive amount, so a fee of nothing has to be no fee rather than a fee of 0,
 * and with `FEE_BPS` unset that is every sale today.
 *
 * `metadata` says whose sale this is in the two words the webhook routes by,
 * plus the cart. It is copied onto `payment_intent_data[metadata]` as well, and
 * that is not redundancy: a REFUND arrives as a `charge.refunded`, whose object
 * inherits the PaymentIntent's metadata and knows nothing of the session, so
 * without this the refund of a sale could not be told whose it was.
 */
export let session = (at: {
  space: string
  app: string
  root: string
  lines: unknown[]
  total: number
  packed: string
  email?: string
  success: string
  cancel: string
}) => {
  let cut = fee(at.total)
  let metadata = { space: at.space, app: at.app, items: at.packed }
  return {
    mode: 'payment',
    line_items: Object.fromEntries(at.lines.map((l, i) => [i, l])),
    success_url: at.success,
    cancel_url: at.cancel,
    ...(at.email ? { customer_email: at.email } : {}),
    metadata,
    payment_intent_data: {
      ...(cut > 0 ? { application_fee_amount: cut } : {}),
      metadata,
    },
  }
}

/**
 * The door itself (apps.ts routes `/<app>/api/pay/checkout` here).
 *
 * `rows` is how the caller reads the app's store — the same read `/api/query`
 * makes, as whoever is asking, so a private app's shelf is its members' and a
 * public one's is the world's. The door adds no reading power of its own.
 *
 * A space that is not ready is refused BY NAME with the way out, because that
 * refusal is the one a page will actually meet: a seller deploys their shop
 * before they finish Stripe's form nearly every time.
 */
export let buying = async (
  env: Env,
  at: { space: Space; app: string; root: string },
  rows: (line: string) => Promise<Product[]>,
  body: unknown,
) => {
  let no = (status: number, code: string, message: string) =>
    Response.json({ error: { code, message } }, { status })
  if (!env.STRIPE_KEY) {
    return no(503, 'no_selling', 'selling is not switched on here')
  }
  let where = selling(at.space)
  if (where != 'ready') {
    return no(
      409,
      'not_selling',
      where == 'none'
        ? `${at.space.slug} has not connected a Stripe account — ask whoever ` +
          'runs this space to start selling, and nothing here can charge ' +
          'anybody until they have'
        : `${at.space.slug} has connected Stripe but has not finished ` +
          'setting up — Stripe has not said they may take payments yet',
    )
  }
  let items: Item[]
  let priceless: ReturnType<typeof priced>
  let success: string
  let cancel: string
  try {
    items = cart(body)
    // One read, whatever the cart's length: the products it names, whole.
    // `.eid=` and not `id=` — the bare spelling is the PAGE's grammar and this
    // is a line built for the STORE (wire.ts `RIDERS` is the translation, and
    // this side of it never sees one).
    priceless = priced(
      await rows(`.eid=${items.map((i) => i.product).join(',')}`),
      items,
    )
    let asked = body as { success?: unknown; cancel?: unknown; email?: unknown }
    success = backAt(at.root, asked.success)
    cancel = backAt(at.root, asked.cancel)
  } catch (e) {
    return no(400, 'refused', e instanceof Error ? e.message : String(e))
  }
  let email = String((body as { email?: unknown })?.email ?? '').trim()
  try {
    let made = await ask(
      env,
      '/v1/checkout/sessions',
      session({
        space: at.space.eid,
        app: at.app,
        root: at.root,
        lines: priceless.lines,
        total: priceless.total,
        packed: priceless.packed,
        ...(email ? { email } : {}),
        success,
        cancel,
      }),
      // The seller's account. This one header is the whole of what makes it
      // their charge rather than ours.
      at.space.stripe!.account,
    )
    let url = String(made.url ?? '')
    if (!url) throw new Error('stripe made a checkout session with no url')
    return Response.json({ url })
  } catch (e) {
    await broke(env, `POST /${at.app}/api/pay/checkout`, e)
    return no(
      502,
      'checkout_failed',
      "we couldn't start that — it's been logged, try again in a minute",
    )
  }
}

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

// ---- the order (T-34526) ---------------------------------------------------

/**
 * The entity a sale is written at, derived from Stripe's own session id rather
 * than minted.
 *
 * THIS IS THE IDEMPOTENCE, and it is stronger than remembering event ids would
 * be. At-least-once delivery means `checkout.session.completed` arrives twice
 * for one sale; a minted eid would make two orders and a remembered-event list
 * would be a second thing to keep correct. Deriving it means the second
 * delivery addresses the row the first one wrote, derives the same columns, and
 * moves nothing — the same rule `moved` keeps for a seller's row, one level up.
 *
 * Shaped as a uuid because that is what a store's eids are (src/edge.ts
 * `edgeEid` derives one the same way, off a sentence rather than a session).
 */
export let orderEid = (session: string): string => {
  let h = sha256(`order\x00${session}`).slice(0, 32)
  let variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16)
  let s = `${h.slice(0, 12)}8${h.slice(13, 16)}${variant}${h.slice(17)}`
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${
    s.slice(16, 20)
  }-${s.slice(20)}`
}

/** The cart read back out of a session's metadata — {@link packed}, undone.
 * Junk answers an empty list rather than throwing: an order whose items cannot
 * be read is still an order somebody paid for, and losing the money over the
 * label would be the worse mistake. */
export let unpacked = (items: unknown): Item[] => {
  try {
    let out = JSON.parse(String(items ?? '[]')) as {
      p?: string
      q?: number
      o?: string
    }[]
    return (Array.isArray(out) ? out : []).map((i) => ({
      product: String(i.p ?? '').replace(
        /^(.{8})(.{4})(.{4})(.{4})(.{12})$/,
        '$1-$2-$3-$4-$5',
      ),
      qty: Number(i.q ?? 1),
      ...(i.o ? { options: String(i.o) } : {}),
    }))
  } catch {
    return []
  }
}

/** The slice of a completed Checkout Session this reads. */
export type Session = {
  id?: string
  payment_intent?: string | { id?: string }
  payment_status?: string
  amount_total?: number
  currency?: string
  customer_email?: string | null
  customer_details?: { email?: string | null }
  metadata?: Record<string, string>
}

let idOf = (v: string | { id?: string } | undefined | null) =>
  typeof v == 'string' ? v : v?.id ?? ''

/**
 * The `order` row one completed session makes.
 *
 * The buyer's address is `customer_details.email` and only falls back to
 * `customer_email`: the second is the PREFILL the door sent, and the person may
 * have typed a different one on Stripe's page — which is the address the
 * receipt has to go to.
 *
 * `fee_cents` is derived here rather than read back off Stripe. The session
 * carries no application fee at all (it lives on the PaymentIntent), and one
 * more round trip to learn a number we computed on the way out would be a call
 * that can fail for nothing.
 */
export let orderOf = (o: Session, account: string) => {
  let total = Math.max(0, Math.floor(Number(o.amount_total ?? 0)))
  return {
    session: String(o.id ?? ''),
    intent: idOf(o.payment_intent),
    account,
    items: String(o.metadata?.items ?? '[]'),
    total_cents: total,
    fee_cents: fee(total),
    email: String(o.customer_details?.email || o.customer_email || ''),
    status: 'paid',
  }
}

/** What the buyer is told, in the app's own voice. Markdown, because that is
 * what an app's letters are (mail.ts, guide/mail.md) — one line per thing they
 * bought, and the total under it. */
export let receipt = (
  app: string,
  order: ReturnType<typeof orderOf>,
  items: Item[],
  named: (product: string) => string,
) => {
  let money = (cents: number) => `$${(cents / 100).toFixed(2)}`
  return {
    title: `Your order from ${app}`,
    body: [
      'Thank you — your payment went through. Here is what you bought:',
      '',
      ...items.map((i) =>
        `- ${named(i.product)}${i.options ? ` (${i.options})` : ''} × ${i.qty}`
      ),
      '',
      `**Total ${money(order.total_cents)}**`,
      '',
      'Reply to this letter if anything is wrong with it — it reaches the ' +
      'seller directly.',
    ].join('\n'),
  }
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
  if (type == 'checkout.session.completed') return await sold(env, space, event)
  if (type == 'charge.refunded' || type == 'charge.dispute.created') {
    return await settled(env, space, event)
  }
  return 'nothing to do'
}

// ---- the sale, written into the app's own store ----------------------------

/** The app one of these events happened in, off the metadata we put on the
 * session. Null for a sale in an app that has since been deleted, or for a
 * charge somebody made on the seller's account outside this platform — which is
 * a normal thing for a merchant to do and is none of our business. */
let inApp = async (env: Env, space: Space, slug: string) => {
  if (!slug) return null
  let dir = dirOf(env)
  let app = await dir.app(space, slug)
  return app && !app.trashed ? app : null
}

/** The app's own store, opened as THE APP (dispatch.ts `owning`, T-34303). The
 * platform is writing the app's data on its behalf, so the byline on the row is
 * the app's entity and not a person's — nobody signed in, and the buyer is not
 * a member here and never will be. `editor` is what puts that write past the
 * app's own `access` and no further. */
let asApp = (env: Env, space: Space, app: App) => {
  let store = appStore(env.STORE, space, app)
  let who = { 'x-yak-person': app.eid, 'x-yak-role': 'editor' }
  return metaOf((path, init, sent) => store(path, init, { ...who, ...sent }))
}

/**
 * A completed checkout, as one batch into the app's store: the order, the buyer
 * as an entity, and the letter to them.
 *
 * ONE BATCH on purpose. A store applies it atomically, so there is no state
 * where the money is recorded and the receipt is not, or the other way round —
 * and because the order's eid is derived from the session, a redelivery writes
 * the identical batch and the store moves nothing.
 *
 * `payment_status` is the gate and `status` is not: a session can be `complete`
 * with a payment still processing (a bank debit, say), and `paid` is the word
 * Stripe documents as "the funds are available". Anything else is left for the
 * `async_payment_succeeded` that follows, and answered plainly here.
 */
let sold = async (env: Env, space: Space, event: Event) => {
  let o = (event.data?.object ?? {}) as Session
  if (o.payment_status != 'paid') return `not paid yet (${o.payment_status})`
  let slug = String(o.metadata?.app ?? '')
  let app = await inApp(env, space, slug)
  if (!app) return `no app ${slug || '?'} in ${space.slug}`
  let order = orderOf(o, event.account ?? '')
  if (!order.session) return 'a session with no id'
  let items = unpacked(order.items)
  let store = asApp(env, space, app)
  // What the products are CALLED, for the letter. Read from the app's own
  // store, because the session carries the name the buyer saw and this is the
  // name the seller wrote — and a product renamed between the sale and the
  // receipt should read as it does today.
  let named = new Map<string, string>()
  if (items.length) {
    for (
      let row of await store.query(
        `.eid=${items.map((i) => i.product).join(',')}`,
      ) as Product[]
    ) named.set(row.entity.eid, row.doc?.title ?? '')
  }
  let eid = orderEid(order.session)
  let letter = receipt(
    app.title || app.slug,
    order,
    items,
    (p) => named.get(p) || 'Item',
  )
  await store.apply([
    { entity: { eid }, doc: { title: letter.title }, order },
    // The buyer as a row of their own, and the letter hanging off it — the
    // shape every app's mailbox uses (guide/mail.md). No `deliver` where there
    // is no address to deliver to, which is a sale Stripe took without one; the
    // order still lands, because the money still moved.
    ...(order.email
      ? [
        { entity: { eid: '$them' }, email: { address: order.email } },
        {
          entity: { eid: `${eid}-letter` },
          doc: letter,
          mail: {},
          deliver: { to: '$them' },
        },
      ]
      : []),
  ])
  return `${app.slug}: paid ${order.total_cents}`
}

/**
 * A refund or a dispute, as one column moving on the order it is about.
 *
 * Neither event knows anything about a checkout session, so both are found by
 * the PaymentIntent — which is why the door put its metadata on the intent as
 * well as the session (`session` above). A charge inherits the intent's
 * metadata, so a refund says which app it happened in; a dispute does not carry
 * metadata at all, so its charge is read back from Stripe, on the seller's own
 * account, and the metadata comes off that.
 *
 * A refund that finds no order is not a break: a merchant refunds charges they
 * made outside this platform too, on the same account.
 */
let settled = async (env: Env, space: Space, event: Event) => {
  let o = (event.data?.object ?? {}) as {
    id?: string
    charge?: string
    payment_intent?: string | { id?: string }
    metadata?: Record<string, string>
  }
  let dispute = event.type == 'charge.dispute.created'
  let about = o
  if (dispute) {
    let charge = idOf(o.charge)
    if (!charge) return 'a dispute about no charge'
    about = await ask(
      env,
      `/v1/charges/${charge}`,
      undefined,
      event.account,
    ) as typeof o
  }
  let intent = idOf(about.payment_intent)
  let app = await inApp(env, space, String(about.metadata?.app ?? ''))
  if (!intent || !app) return 'not a sale of ours'
  let store = asApp(env, space, app)
  let [row] = await store.query(`.order.intent=${intent}`) as {
    entity: { eid: string }
    order?: { status?: string }
  }[]
  if (!row) return 'no order for that payment'
  let status = dispute ? 'disputed' : 'refunded'
  // A dispute on an order already disputed, or a second `charge.refunded` for a
  // partial refund that grew: the column is already where it is going, so
  // nothing is written.
  if (row.order?.status == status) return 'unchanged'
  await store.apply([{ entity: { eid: row.entity.eid }, order: { status } }])
  return `${app.slug}: ${status}`
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
