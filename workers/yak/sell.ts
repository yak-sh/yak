// Selling through yaks.app (T-34523): a space connects an account of its own
// at the payment provider config.ts `payments` names, and its apps take money
// on it, with the platform taking a fee on the way past. The provider's wire
// is its own (payments.ts `shops`, @yaks/host/payments `Shops`); what is
// decided here is the platform's: who may sell, the fee, the cart priced
// against the app's own rows, and the order written into the app's store with
// the buyer's receipt.
//
// The seller is the merchant: the charge is on their books, the provider's
// processing fee comes out of their money, the customer's statement says their
// name, and a refund or a dispute is theirs to answer and theirs to pay. We are
// not in the middle of it. What we do is open checkouts on their account with
// our own key and name the fee the provider moves to us out of the same
// payment.
//
// So the platform holds three facts about a seller and no more (vocab.ts
// `seller` on the space row, `via` naming the provider): the account's id,
// whether the provider says it may take payments, and whether they finished
// the provider's form. Their bank details, their balance, their payouts and
// their disputes live at the provider, where they belong, and the seller reads
// them in its own dashboard. A platform that copied them would be a platform
// holding money data it does not need and cannot keep current.
//
// This is a different relationship from billing.ts, which is the platform's own
// plan: there the provider sells to us and we are the customer. Nothing crosses
// between them: what the provider hears about a seller's account reaches
// `apply` here, and only what it hears about our own subscriptions reaches
// billing.ts (payment-doors.ts).
//
// Nothing here may fail quietly, the same rule billing.ts keeps: a break is an
// exception entity in the meta store, and a refusal is a sentence the person
// reads.
import { sha256 } from '@yaks/graph/sha256'
import { derivedEid } from '@yaks/graph/identity'
import { moved } from './billing.ts'
import { payments, shops, via } from './payments.ts'
import type {
  Line,
  Paid,
  Sale,
  Seller as Shop,
  Settled,
  Shopped,
} from '@yaks/host/payments'
import { fault } from './unseen.ts'
import * as dirPart from './directory.ts'
import {
  type App,
  appStore,
  type Directory,
  directory,
  paid,
  type Seller,
  type Space,
  stamp,
} from './directory.ts'
import { bound, type Env } from './env.ts'
import { KERNEL, metaOf } from './meta.ts'
import { manageAt } from './route.ts'
import { type Host, url as hostUrl } from './host.ts'
import { adminWho } from './identity.ts'
import { refuse } from './tool.ts'
import { caught, refusing } from './defects.ts'

// ---- the fee ---------------------------------------------------------------

/**
 * What the platform takes from one sale, in basis points — hundredths of a
 * percent, so 250 is 2.5%. It is a setting and not a number in this file
 * (T-34554): `fee.bps` on the platform's own space row (vocab.ts), read at
 * request time, so the owner changes what we charge with `yak admin fee 250` and the
 * next sale pays the new rate with nothing deployed.
 *
 * It is one property because it is said in four places — the fee each checkout
 * names, the pricing page, the terms, and the sentence
 * `space_sell` answers with — and four copies of a number drift the first time
 * one moves. Unset it reads 0, which means every sale goes to the seller whole
 * and nothing is taken. Zero is the honest default: a fee nobody chose, charged
 * to somebody's customer, is worse than no fee at all.
 *
 * The most anybody may set is the whole sale, `MOST` — a rate above 100% is a
 * typo every time, and the provider would refuse the charge it made.
 */
export let MOST = 10_000

/** The platform's cut, as the directory holds it. Nothing is kept between
 * requests: what is read here is what the owner's door last wrote, and that
 * door empties the read cache. */
export let feeOf = async (
  dir: { space: (slug: string) => Promise<Space | null> },
) => (await dir.space(dirPart.META.space))?.fee ?? 0

/** The fee on a total, in cents. Rounded down, so the fee is never a cent more
 * than the rate says, and never more than the sale itself.
 *
 * ```ts
 * fee(1000, 250) // 25
 * fee(999, 250)  // 24 — down, not up
 * fee(1000, 0)   // 0
 * ```
 */
export let fee = (cents: number, bps: number) =>
  Math.min(cents, Math.max(0, Math.floor((cents * bps) / 10_000)))

/** The rate as a person reads it: `2.5%`, or `0%`. One derivation, so the
 * pages and the tool sentence cannot disagree with the arithmetic above. */
export let rate = (bps: number) => `${Math.round(bps / 100 * 100) / 100}%`

/**
 * The rate as the pricing page says it. The page is a file — hand-written,
 * crawled, served straight off the assets binding — so the live rate is
 * spliced into one marked element on the way out, the way the home page's
 * showcase is (gallery.ts `made`). The number in the file stays the fallback,
 * which is what a crawler reading the repo sees and what serves if the
 * directory will not answer.
 */
export let MARK = '<span class="Fee">'

export let quoted = (file: string, bps: number) => {
  let from = file.indexOf(MARK)
  if (from < 0) return file
  let to = file.indexOf('</span>', from)
  if (to < 0) return file
  return file.slice(0, from + MARK.length) + rate(bps) + file.slice(to)
}

// ---- the connected account -------------------------------------------------

/** Where onboarding hands somebody back: the space's own page, both ways.
 *
 * Onboarding hands them back here when they finish and when its link is
 * spent, which is single-use and expires in minutes, and the space page's
 * "Start selling" button asks for a fresh one.
 *
 * It is also the right place to land: the page reads `seller` off the space
 * and says not connected, finishing setup, or ready. A landing page of its own
 * would have to say the same three things and could only say them less
 * currently, since the provider returns the browser the moment the form is
 * submitted, which is before its event saying so has necessarily arrived. */
export let backTo = (space: Space, env: Host = {}) =>
  manageAt(space.slug, 'selling', env)

// ---- what the platform writes down about a seller ---------------------------

/** The `seller` row a provider's word on an account makes, naming the
 * provider (payments.ts `via`). Every writer here ends at this, an account
 * just opened or an event about one, so there is one derivation of the row
 * and no state machine. */
export let sellerOf = (shop: Shop): Seller => ({ via, ...shop })

/** Where a space stands with selling, as one word — what the page, the tool and
 * the checkout door's refusal all read.
 *
 * `ready` is `ready` and nothing else. Not `submitted`: a seller can finish
 * the form and still be held while the provider verifies them, and taking somebody's
 * customer's money in that window is a payment that fails at the till. */
export let selling = (space: Space): 'none' | 'setup' | 'ready' =>
  !space.seller?.account ? 'none' : space.seller.ready ? 'ready' : 'setup'

// New payments require a paid plan. Existing orders and the provider's events
// still settle after a downgrade, and the seller can always disconnect their
// account.
export let refusedSell = (space: Space, env: Host = {}) =>
  paid(space.tier)
    ? null
    : `Taking payments requires the Plus plan. Compare plans: ${
      hostUrl(env, '/pricing')
    }`

// ---- connecting ------------------------------------------------------------

let dirOf = (env: Env) => directory(bound(env.DIRECTORY, dirPart.fetch, env))

/** The space's `seller` row, written whole through the kernel's own door —
 * every property of it is server-owned (vocab.ts), so this is the only
 * writer. */
let wrote = (env: Env, space: Space, seller: Seller | null) =>
  stamp(env, { entities: [{ entity: { eid: space.eid }, seller }] })

/**
 * Connect this space to an account at the provider, and answer the link that
 * finishes it.
 *
 * The account is minted once and kept: a space that starts onboarding, wanders
 * off and comes back a week later gets a new link onto the same account, never
 * a second account — two accounts for one space would be a merchant whose
 * money is split across books nobody can add up. So the id is written the
 * moment the provider answers with it, before the link is asked for, and the
 * second call finds it. Its tags carry the space, so an account read in the
 * provider's dashboard says whose it is.
 *
 * The link is minted fresh every time, because it is single-use and expires.
 */
export let connect = async (env: Env, space: Space, email: string) => {
  let no = refusedSell(space, env)
  if (no) throw refuse('limit', no)
  let lent = await shops(env)
  let id = space.seller?.account
  if (!id) {
    space.seller = sellerOf(
      await lent.open({
        email,
        tags: { space: space.eid, slug: space.slug },
      }),
    )
    id = space.seller.account
    await wrote(env, space, space.seller)
  }
  return { account: id, url: await lent.onboarding(id, backTo(space, env)) }
}

/**
 * Stop selling: the platform forgets the account, and the provider keeps it.
 *
 * Deliberately not a delete. The account is the merchant's own — their money,
 * their payouts, their records of every sale they have made, and the
 * provider's own rules about what may be closed and when. Ours to forget,
 * never ours to destroy. What this does is take the row off the space, so no
 * app here can create another charge on it; the seller's dashboard, balance
 * and history are exactly where they were, and connecting again is one call.
 */
export let disconnect = (env: Env, space: Space) => wrote(env, space, null)

// ---- the checkout door -----------------------------------------------------
//
// `POST /<app>/api/pay/checkout` (apps.ts): a cart in, a hosted checkout's
// address out. The whole reason it is the platform's door and not something an
// app writes is that it is the only place the platform key is spent — an app
// holds no payment key, writes no worker, and cannot charge anybody a penny it
// did not ask for.
//
// Nothing about money comes off the wire. The caller names a product and how
// many; the price is read off that product's own row in the app's store. A page
// that posted a price would be a page a buyer can edit with the developer
// tools, and the first person to try it would buy a shirt for a cent.

/** One line of a cart, as a page or a worker posts it. `options` is a variant
 * the seller offers — a size, a colour — appended to the name the buyer reads
 * on the checkout page, and kept on the order so the seller knows what to put in
 * the box. */
export type Item = { product: string; qty: number; options?: string }

/** The cart, read off a request body. Throws the sentence the caller reads:
 * this is the door a guest reaches, so a refusal has to say what to fix. */
export let cart = (body: unknown): Item[] => {
  let items = (body as { items?: unknown })?.items
  if (!Array.isArray(items) || !items.length) {
    throw refuse(
      'arguments',
      'items: a list of {product, qty} to sell, and not empty',
    )
  }
  return items.map((one, i) => {
    let it = one as Record<string, unknown>
    let product = String(it?.product ?? '')
    if (!product) {
      throw refuse('arguments', `items[${i}].product: name a product`)
    }
    let qty = Math.floor(Number(it?.qty ?? 1))
    if (!(qty > 0)) {
      throw refuse('arguments', `items[${i}].qty: how many, at least one`)
    }
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

/** The items as they ride the checkout and come back on the event: the product,
 * how many, and the variant, in the shortest form that survives a round
 * trip. They ride one tag, so its length is what decides how many lines fit
 * in an order ({@link priced}). Dashes come off the uuid to buy back four
 * characters a line: a uuid without them is 32 characters and a line about
 * 45. */
export let packed = (items: Item[]) =>
  JSON.stringify(
    items.map((i) => ({
      p: i.product.replace(/-/g, ''),
      q: i.qty,
      ...(i.options ? { o: i.options } : {}),
    })),
  )

/**
 * The cart priced against the store's own rows: the sale's lines, the total
 * in cents, and the items packed for one tag, which takes `tag` characters at
 * most (the lent shops' `tag`).
 *
 * Every refusal here happens before the provider is asked, and each says which line
 * is wrong: a product this store does not have (an eid off another app, or one
 * somebody made up), a product with no price, which is a seller's row that
 * is not finished rather than a free shirt, and a cart too big for its tag,
 * refused by name rather than sent for the provider to cut short.
 */
export let priced = (rows: Product[], items: Item[], tag: number) => {
  let by = new Map(rows.map((r) => [r.entity.eid, r]))
  let total = 0
  let lines = items.map((one): Line => {
    let row = by.get(one.product)
    if (!row?.product) {
      throw refuse('missing', `no product ${one.product} in this app`)
    }
    let cents = Math.floor(Number(row.product.price_cents ?? 0))
    if (!(cents > 0)) {
      throw refuse('conflict', `${row.doc?.title || one.product} has no price`)
    }
    let name = row.doc?.title || 'Item'
    total += cents * one.qty
    return {
      name: one.options ? `${name} (${one.options})` : name,
      cents,
      qty: one.qty,
    }
  })
  let meta = packed(items)
  if (meta.length > tag) {
    throw refuse(
      'limit',
      `that is too many different things in one order — about ` +
        `${Math.floor(items.length * tag / meta.length)} lines fit`,
    )
  }
  return { lines, total, packed: meta }
}

/**
 * Where the provider sends the buyer, from what the caller asked for.
 * Relative to the app's own root, always — so nothing in a page writes the
 * app's name and an installed copy sends its buyers back to itself.
 *
 * And it may not leave that root. This door is callable by a guest on an open
 * app, so an absolute URL from the wire would let a stranger have yaks.app's
 * own checkout hand buyers to a page they wrote. `new URL(asked, root)` resolves
 * the ordinary relative case and swallows the absolute one, so what is checked
 * is the answer rather than the input — a filter over the input would be a list
 * of the escapes somebody thought of.
 *
 * The answer is the address as `URL` writes it. A placeholder the provider
 * fills in on the way back is percent-encoded in it, and the provider writes
 * that back itself ({@link Sale.done}), after this check, so nothing about
 * where this points is decided by it.
 */
export let backAt = (root: string, asked: unknown) => {
  let at = String(asked ?? '').trim()
  if (!at) return root
  let out: URL
  try {
    out = new URL(at, root)
  } catch {
    throw refuse('arguments', `${at} is not an address`)
  }
  if (!out.href.startsWith(root)) {
    throw refuse(
      'arguments',
      `success and cancel stay inside this app (${root})`,
    )
  }
  return out.href
}

/**
 * The checkout a cart makes, on the seller's account (payments.ts `shops`):
 * its lines in dollars, the platform's cut of the total, and the buyer sent
 * back inside the app either way.
 *
 * Its tags say whose sale this is in the two words the webhook routes by, plus
 * the cart, and ride the payment as well as the checkout: a refund or a
 * dispute is about the payment and knows nothing of the checkout, so without
 * them it could not be told whose it was. The rate this sale was charged at
 * rides with it too. The rate is a setting (`feeOf`), so the number in force
 * when the checkout was made is not necessarily the number in force when the
 * webhook files the order minutes later, and what an order records has to be
 * what was taken.
 */
export let sale = (at: {
  space: string
  app: string
  lines: Line[]
  total: number
  packed: string
  bps: number
  email?: string
  success: string
  cancel: string
}): Sale => ({
  lines: at.lines,
  currency: 'usd',
  fee: fee(at.total, at.bps),
  ...(at.email ? { email: at.email } : {}),
  done: at.success,
  cancel: at.cancel,
  tags: {
    space: at.space,
    app: at.app,
    items: at.packed,
    fee: String(at.bps),
  },
})

/**
 * The door itself (apps.ts routes `/<app>/api/pay/checkout` here).
 *
 * `rows` is how the caller reads the app's store — the same read `/api/query`
 * makes, as whoever is asking, so a private app's shelf is its members' and a
 * public one's is the world's. The door adds no reading power of its own.
 *
 * A space that is not ready is refused by name with the way out, because that
 * refusal is the one a page will actually meet: a seller deploys their shop
 * before they finish the provider's form nearly every time.
 */
export let buying = async (
  env: Env,
  at: { space: Space; app: string; root: string },
  rows: (line: string) => Promise<Product[]>,
  body: unknown,
) => {
  let no = (status: number, code: string, message: string) =>
    Response.json({ error: { code, message } }, { status })
  let { name, shops: lent } = await payments(env)
  if (!lent.on()) {
    return no(503, 'no_selling', 'selling is not switched on here')
  }
  let upgrade = refusedSell(at.space, env)
  if (upgrade) return no(403, 'plus_required', upgrade)
  let where = selling(at.space)
  if (where != 'ready') {
    return no(
      409,
      'not_selling',
      where == 'none'
        ? `${at.space.slug} has not connected a ${name} account — ask ` +
          'whoever runs this space to start selling, and nothing here can ' +
          'charge anybody until they have'
        : `${at.space.slug} has connected ${name} but has not finished ` +
          `setting up — ${name} has not said they may take payments yet`,
    )
  }
  let items: Item[]
  let priceless: ReturnType<typeof priced>
  let success: string
  let cancel: string
  try {
    items = cart(body)
    // One read, whatever the cart's length: the products it names, whole.
    // `.entity.eid=` and not `id=` — the bare form is the page's grammar and this
    // is a line built for the store (wire.ts `RIDERS` is the translation, and
    // this side of it never sees one).
    priceless = priced(
      await rows(`.entity.eid=${items.map((i) => i.product).join(',')}`),
      items,
      lent.tag,
    )
    let asked = body as {
      success?: unknown
      cancel?: unknown
      email?: unknown
    }
    success = backAt(at.root, asked.success)
    cancel = backAt(at.root, asked.cancel)
  } catch (e) {
    return no(
      refusing(e, { request: 'POST /api/pay/checkout', app: at.app }),
      'refused',
      e instanceof Error ? e.message : String(e),
    )
  }
  let email = String((body as { email?: unknown })?.email ?? '').trim()
  try {
    let url = await lent.checkout(
      // The seller's account, which makes it their charge rather than ours.
      at.space.seller!.account,
      sale({
        space: at.space.eid,
        app: at.app,
        lines: priceless.lines,
        total: priceless.total,
        packed: priceless.packed,
        // The rate as it stands right now, read fresh (`dirOf`): a sale is
        // charged what the owner set a moment ago, never what a cached row
        // still says.
        bps: await feeOf(dirOf(env)),
        ...(email ? { email } : {}),
        success,
        cancel,
      }),
    )
    return Response.json({ url })
  } catch (e) {
    await fault(env, `POST /${at.app}/api/pay/checkout`, e)
    return no(
      502,
      'checkout_failed',
      "we couldn't start that — it's been logged, try again in a minute",
    )
  }
}

// ---- the order (T-34526) ---------------------------------------------------

/**
 * The entity a sale is written at, derived from the provider's own checkout id
 * rather than minted.
 *
 * This is the idempotence, and it is stronger than remembering event ids would
 * be. At-least-once delivery means the provider's word that a checkout
 * completed arrives twice for one sale; a minted eid would make two orders and
 * a remembered-event list would be a second thing to keep correct. Deriving it
 * means the second delivery addresses the row the first one wrote, derives the
 * same properties, and moves nothing — the same rule `moved` keeps for a
 * seller's row, one level up.
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

/** The cart read back out of a checkout's tags — {@link packed}, undone.
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

/**
 * The `order` row one completed checkout makes, on the seller's `account`.
 *
 * `fee_cents` is derived here rather than read back off the provider. The
 * checkout carries no fee of its own (it lives on the payment), and one more
 * round trip to learn a number we computed on the way out would be a call that
 * can fail for nothing. It is derived from the rate the checkout carries
 * (`tags.fee`) and never from the rate in force now: the owner may have moved
 * it between the checkout and this event, and the order says what was taken.
 * A checkout made before that tag existed carries no rate and reads 0, which
 * is the fee those sales were charged.
 */
export let orderOf = (o: Paid, account: string) => ({
  session: o.checkout,
  intent: o.payment,
  account,
  items: String(o.tags.items ?? '[]'),
  total_cents: o.total,
  fee_cents: fee(o.total, Math.max(0, Number(o.tags.fee ?? 0) || 0)),
  email: o.email,
  status: 'paid',
})

/** What the buyer is told, in the app's own voice. Markdown, because that is
 * what an app's letters are (mail.ts, docs/mail.md) — one line per thing they
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
 * One verified event about a seller's account, as the provider heard it at
 * its door (payment-doors.ts), applied.
 * Answers what it did, which is what the door says back: the provider ignores
 * the body, and a person reading the logs does not.
 *
 * What it can say, and why each matters:
 *   a seller's account changed  the provider changed its mind about a seller
 *   it revoked us               a seller disconnected US, from their own
 *                               dashboard — the one direction we cannot learn
 *                               about any other way
 *   a sale                      somebody bought something (T-34526)
 *   a payment moved             it was refunded or disputed (T-34526), or the
 *                               dispute was decided (T-37887)
 */
export let apply = async (env: Env, heard: Shopped): Promise<string> => {
  let on = heard.account
  if (!on) return 'not a connected account event'
  let dir = dirOf(env)
  let space = await dir.seller(via, on)
  // An account we have no space for: a seller who disconnected, or another
  // platform's event at our door. Nothing to retry — a second delivery finds
  // the same nothing — so it is not filed and the door answers 200 rather than
  // making the provider repeat an unanswerable question for days.
  if (!space) return 'no space sells through that account'
  if (heard.about == 'seller') {
    // The id comes from the row we already hold, never from the payload: the
    // event was attributed by that id, and an account that answered a
    // different one would be the provider telling us it changed identity.
    let next = sellerOf({ ...heard.seller, account: on })
    if (!Object.keys(moved(space.seller, next)).length) return 'unchanged'
    await wrote(env, space, next)
    return `${space.slug} ${next.ready ? 'can' : 'cannot'} sell`
  }
  // The seller revoked us from their own dashboard. The account still exists
  // and is still theirs; what ended is our permission to act on it, so the row
  // comes off the space exactly the way `space_sell(disconnect: true)` takes it
  // off. Anything else would leave the space looking ready to sell through an
  // account that would refuse the next charge.
  if (heard.about == 'revoked') {
    await disconnect(env, space)
    return `${space.slug} disconnected`
  }
  if (heard.about == 'sale') return await sold(env, space, on, heard.sale)
  if (heard.about == 'payment') {
    return await settled(env, space, heard.to, await heard.payment())
  }
  return 'nothing to do'
}

// ---- the sale, written into the app's own store ----------------------------

/** The app one of these events happened in, off the tags we put on the
 * checkout. Null for a sale in an app that has since been deleted, or for a
 * charge somebody made on the seller's account outside this platform — which is
 * a normal thing for a merchant to do and is none of our business. */
let inApp = async (env: Env, space: Space, slug: string) => {
  if (!slug) return null
  let dir = dirOf(env)
  let app = await dir.app(space, slug)
  return app && !app.trashed ? app : null
}

/** The app's own store, written by the platform (meta.ts `KERNEL`) with the
 * app's byline. The byline is the app's entity and not a person's — nobody
 * signed in, and the buyer is not a member here and never will be. The door is
 * the kernel's because an order's properties are server-owned (vocab.ts
 * `order`, T-37881): the one writer who can say a sale was paid is the one that
 * heard it from the provider. `editor` is what lets the reads beside it (the products
 * a receipt names, the order a refund finds) past a private app's `access`. */
let asApp = (env: Env, space: Space, app: App) => {
  let store = appStore(env.STORE, space, app, env)
  let who = { ...KERNEL, 'x-yak-person': app.eid, 'x-yak-role': 'editor' }
  return metaOf(store, who)
}

/**
 * A completed checkout, as one batch into the app's store: the order, the buyer
 * as an entity, and the letter to them.
 *
 * One batch on purpose. A store applies it atomically, so there is no state
 * where the money is recorded and the receipt is not, or the other way round —
 * and because the order's eid is derived from the checkout, a redelivery
 * writes the identical batch and the store moves nothing.
 *
 * Only a checkout whose money is there is an order: one completed with its
 * payment still processing (a bank debit, say) is left for the word that
 * follows, and answered plainly here.
 */
let sold = async (env: Env, space: Space, account: string, o: Paid) => {
  if (!o.paid) return `not paid yet (${o.status})`
  let slug = String(o.tags.app ?? '')
  let app = await inApp(env, space, slug)
  if (!app) return `no app ${slug || '?'} in ${space.slug}`
  let order = orderOf(o, account)
  if (!order.session) return 'a session with no id'
  let items = unpacked(order.items)
  let store = asApp(env, space, app)
  // What the products are called, for the letter. Read from the app's own
  // store, because the checkout carries the name the buyer saw and this is the
  // name the seller wrote — and a product renamed between the sale and the
  // receipt should read as it does today.
  let named = new Map<string, string>()
  if (items.length) {
    for (
      let row of await store.query(
        `.entity.eid=${items.map((i) => i.product).join(',')}`,
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
    // shape every app's mailbox uses (docs/mail.md). No `deliver` where there
    // is no address to deliver to, which is a sale the provider took without one; the
    // order still lands, because the money still moved.
    ...(order.email
      ? [
        { entity: { eid: '$them' }, email: { address: order.email } },
        {
          entity: { eid: derivedEid(`${eid}-letter`) },
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
 * A refund or a dispute, as one property moving on the order it is about.
 *
 * Neither knows anything about a checkout, so both are found by the payment,
 * which is why the checkout's tags ride the payment as well (`sale` above):
 * the payment the provider names says which app it happened in.
 *
 * A refund that finds no order is not a break: a merchant refunds charges they
 * made outside this platform too, on the same account.
 *
 * TODO, and it cannot bite while the fee is 0: the provider need not give our
 * fee back when a charge is refunded, so the day the owner sets a rate, a
 * seller who refunds from their own dashboard is out of pocket by our fee. The
 * fix is ours to make: the seller has already made the refund by the time we
 * hear about it, so it is the fee refunded in proportion, which the shops
 * contract would lend. Left unbuilt rather than built untested: there is no
 * fee to give back today, and the first sale with a rate on it is what should
 * drive the shape.
 */
let settled = async (
  env: Env,
  space: Space,
  to: Settled,
  payment: { id: string; tags: Record<string, string> } | null,
) => {
  let app = payment && await inApp(env, space, String(payment.tags.app ?? ''))
  if (!payment || !app) return 'not a sale of ours'
  let store = asApp(env, space, app)
  let [row] = await store.query(`.order.intent=${payment.id}`) as {
    entity: { eid: string }
    order?: { status?: string }
  }[]
  if (!row) return 'no order for that payment'
  // A dispute decided undoes the dispute and nothing else: an order refunded
  // meanwhile stays refunded.
  let closed = to == 'lost' || to == 'restored'
  if (closed && row.order?.status != 'disputed') return 'unchanged'
  let status = to == 'restored' ? 'paid' : to
  // A dispute on an order already disputed, or a redelivery: the property is
  // already where it is going, so nothing is written.
  if (row.order?.status == status) return 'unchanged'
  await store.apply([{ entity: { eid: row.entity.eid }, order: { status } }])
  return `${app.slug}: ${status}`
}

// ---- the owner's door (T-34554) --------------------------------------------

let json = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message } }, { status })

/**
 * The pricing page as it is served: the file, with the live rate in its one
 * marked element. A directory that will not answer is the page with its own
 * number in it, never a pricing page that does not serve — the same bargain
 * `gallery.made` makes for the home page's showcase.
 */
export let priceAt = async (dir: Directory, file: Response) => {
  let html = await file.text()
  let bps = await feeOf(dir).catch((e) => {
    caught(e, { request: 'pricing fee' })
    return 0
  })
  let headers = new Headers(file.headers)
  // The two headers that describe the bytes: the body just changed length, and
  // it is no longer the file that etag names.
  headers.delete('content-length')
  headers.delete('etag')
  return new Response(quoted(html, bps), { status: file.status, headers })
}

/**
 * `GET /api/fee` reads the platform's cut and `POST /api/fee` (`bps=250`) sets
 * it — `yak admin fee` on the owner's box, and the only writer of the property.
 *
 * The gate is A seat in `yak`, the platform's own space: whoever owns that row
 * owns the platform, which is the same authority `space_sell` and the meter
 * already answer to. A website session or an OAuth token identifies the caller;
 * a pasted grant does not. The connector's tool roster does not expose this door.
 *
 * It writes through `stamp`, which empties the directory's read cache, so the
 * rate a sale is charged is the rate set a moment ago rather than one a TTL
 * later. Under `/api/`, so the same-origin guard (route.ts `guarded`) stands in
 * front of it: sibling spaces are same-site, and without that guard a page in
 * anybody's space could aim a form at this door and the owner's cookie would
 * ride along. A CLI sends no `Origin` at all and is unaffected.
 */
export let fees = async (req: Request, env: Env) => {
  let dir = dirOf(env)
  let meta = await dir.space(dirPart.META.space)
  if (!meta) {
    return json(503, 'no_platform', 'the directory has not seeded yet')
  }
  let who = await adminWho(
    env,
    req,
    (person) => dir.role(meta, person),
  )
  if (who.role != 'owner') {
    return json(403, 'not_owner', `the fee is set by an owner of ${meta.slug}`)
  }
  if (req.method == 'POST') {
    // Read as digits and not as a number: `Number('')` and `Number(null)` are
    // both 0, so a post that named no rate at all would otherwise read as the
    // owner setting the fee to nothing.
    let said = (await req.formData()).get('bps')
    let digits = typeof said == 'string' && /^\d+$/.test(said)
    let bps = digits ? Number(said) : NaN
    if (!Number.isInteger(bps) || bps > MOST) {
      return json(
        400,
        'bad_fee',
        `the fee is whole basis points, 0 to ${MOST}: ` +
          `${said == null || said == '' ? '(nothing)' : said} is not one`,
      )
    }
    await stamp(env, {
      entities: [{ entity: { eid: meta.eid }, fee: { bps } }],
    })
    return Response.json({ bps, rate: rate(bps) })
  }
  if (req.method != 'GET') {
    return json(405, 'method_not_allowed', 'get the fee, or post one')
  }
  let bps = meta.fee
  return Response.json({ bps, rate: rate(bps) })
}
