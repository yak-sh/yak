// Domains a person buys through their space. The core is the order's life,
// as data and decisions: a name a registry offers, the order a paid checkout
// writes, the registration the registry works through, and the marks that
// say how it ended. Everything that reaches outside goes through `Ports`,
// which a host fills: a registry (@yaks/cloudflare/registrar is one), the
// graph the order lives in, how a name is attached to a place there, and
// where a zone's records are written.
//
// The registry holds every name in the host's own account, and the host
// renews it while the space that bought it pays (`renew`): the first year is
// the buyer's, at the registry's price, and every later one comes with their
// plan, so a name is sold only where its renewal is one a plan can carry
// (`sold`). The person adds no DNS record: the host owns the zone, so
// `fulfil` writes every record the attachment needs. A paid order that can't
// be fulfilled is refunded, once.
import type { Bundle } from '@yaks/graph'
import { line } from '@yaks/query'

/** One name as a registry offers it: whether it can be registered now, what
 * a year costs to register and to renew, in cents of `currency`, and why not
 * where it can't (`domain_unavailable`, `domain_premium`, …). */
export type Offer = {
  name: string
  registrable: boolean
  cents?: number
  renews?: number
  currency?: string
  reason?: string
}

/** Where a registration's workflow stands. `succeeded` and `failed` end it;
 * `action_required` will not move on its own. */
export type State =
  | 'pending'
  | 'in_progress'
  | 'action_required'
  | 'blocked'
  | 'succeeded'
  | 'failed'

/** A registration as the registry last said it, and when the name expires
 * once it is registered. */
export type Registration = {
  name: string
  state: State
  expires?: string
  error?: string
}

/** What a registry does for the host's account. */
export type Registry = {
  /** names suggested for a query, from the registry's cache */
  search: (q: string, limit?: number) => Promise<Offer[]>
  /** whether each name can be registered now, and its price */
  check: (names: string[]) => Promise<Offer[]>
  /** register a name, charged to the account, renewing or not; sent once */
  register: (name: string, renew: boolean) => Promise<Registration>
  /** where a name's registration stands; null where it was never asked */
  registration: (name: string) => Promise<Registration | null>
  /** turn a registered name's renewal on or off */
  renewing: (name: string, on: boolean) => Promise<void>
  /** the id of the zone that serves a registered name's DNS, made if none */
  zone: (name: string) => Promise<string>
}

/** A DNS record as a zone holds it. */
export type Rec = {
  type: string
  name: string
  content: string
  priority?: number
  proxied?: boolean
}

/** What the core reaches outside through, filled by its host. */
export type Ports = {
  registry: Registry
  graph: {
    read: (q: ReturnType<typeof line>) => Promise<Bundle[]>
    apply: (bundles: Bundle[]) => Promise<unknown>
  }
  /** whether a space's plan pays, which renewal follows */
  paying: (space: string) => Promise<boolean>
  /** attach a registered name to the space or app it serves, and answer the
   * records its DNS needs */
  attach: (
    name: string,
    serves: string | undefined,
    space: string,
  ) => Promise<Rec[]>
  /** write records into a zone, leaving the ones already there */
  write: (zone: string, records: Rec[]) => Promise<void>
  /** an order's payment returned whole, asked again without refunding
   * twice; answers the refund's id */
  refund: (order: Placed) => Promise<string>
  now?: () => string
}

/** What a buyer orders: the name, the space paying and the place it serves,
 * the price they were shown, and whether their payment moved money (a
 * sandbox's registers nothing). */
export type Order = {
  name: string
  space: string
  bought_by?: string
  serves?: string
  cents: number
  renews?: number
  live: boolean
}

/** An order as its paid checkout wrote it. */
export type Placed = Order & { checkout: string }

/** The order a paid checkout writes, its eid derived from the checkout by
 * the host, and written only where none is (`$was`), so a payment told
 * twice orders once.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let o = { name: 'ada.com', space: 's', serves: 'a', cents: 1044, live: true }
 * assertEquals(ordered('e', 'cs_1', o), {
 *   entity: { eid: 'e' },
 *   $was: { domain_order: { checkout: null } },
 *   domain_order: { ...o, checkout: 'cs_1' },
 * })
 * ```
 */
export let ordered = (eid: string, checkout: string, o: Order): Bundle => ({
  entity: { eid },
  $was: { domain_order: { checkout: null } },
  domain_order: { ...o, checkout },
})

/** A registration still under way: its effect runs again after `after` ms.
 * One that needs a person (`action_required`) waits longer and says so. */
export class Waiting extends Error {
  override name = 'Waiting'
  retry: { after: number }
  constructor(readonly registration: Registration) {
    super(`${registration.name} is ${registration.state.replace(/_/g, ' ')}`)
    this.retry = {
      after: registration.state == 'action_required' ? 3_600_000 : 60_000,
    }
  }
}

/** What fulfilling an order did. */
export type Fulfilled =
  | { done: 'registered'; name: string; expires?: string }
  | { done: 'refunded'; why: string; refund: string; order: Placed }
  | { done: 'nothing' }

let iso = (p: Ports) => p.now?.() ?? new Date().toISOString()

type Row = Bundle & { created?: { at?: string } }

// Whether `a` was ordered before `b`: by when each was written, and by eid
// where that ties, so two orders always agree which came first.
let before = (a: Row, b: Row) =>
  (a.created?.at ?? '') < (b.created?.at ?? '') ||
  (a.created?.at == b.created?.at && a.entity.eid < b.entity.eid)

// Why an order can't be registered before the registry is asked: a sandbox
// payment, or another paid order for the same name that holds it or came
// first. One name is attached to one place, so the later order is refunded.
let barred = async (p: Ports, row: Row, order: Placed) => {
  if (!order.live) return 'a sandbox payment registers no domain'
  let rivals = (await p.graph.read(line`.domain_order.name=${order.name}`))
    .filter((b) =>
      b.entity.eid != row.entity.eid && !b.domain_refused &&
      (b.domain_order as Placed).live
    )
  return rivals.some((b) => b.domain_registered || before(b, row))
    ? `${order.name} was bought first at another checkout`
    : null
}

// A paid order that can't be fulfilled, marked so and its payment returned:
// `domain_refused` first, so a refund that fails is asked again on the next
// run, and `domain_refunded` once it is made.
let refunded = async (
  p: Ports,
  eid: string,
  order: Placed,
  why: string,
  marked: boolean,
): Promise<Fulfilled> => {
  if (!marked) {
    await p.graph.apply([{
      entity: { eid },
      domain_refused: { at: iso(p), why },
    }])
  }
  let refund = await p.refund(order)
  await p.graph.apply([{
    entity: { eid },
    domain_refunded: { at: iso(p), refund },
  }])
  return { done: 'refunded', why, refund, order }
}

/** Register an order's name and attach it: the registration read first, so
 * an order asked again never registers twice; asked for where there is none;
 * waited out while it runs (thrown as {@link Waiting}); and once it holds,
 * the zone made, the name attached to its place and every record written.
 * An order that can't be registered (a sandbox payment, a name another
 * checkout bought first, or one the registry refuses) is marked
 * `domain_refused` and refunded once, `domain_refunded`. */
export let fulfil = async (p: Ports, eid: string): Promise<Fulfilled> => {
  let [row] = await p.graph.read(line`.entity.eid=${eid}`) as Row[]
  let order = row?.domain_order as Placed | undefined
  if (!order || row.domain_registered || row.domain_refunded) {
    return { done: 'nothing' }
  }
  let refused = (row.domain_refused as { why?: string } | undefined)?.why
  let why = refused ?? await barred(p, row, order)
  if (why) return await refunded(p, eid, order, why, refused != null)
  let r = await p.registry.registration(order.name) ??
    await p.registry.register(order.name, await p.paying(order.space))
  if (r.state == 'failed') {
    return await refunded(
      p,
      eid,
      order,
      r.error ?? 'the registry refused it',
      false,
    )
  }
  if (r.state != 'succeeded') throw new Waiting(r)
  let zone = await p.registry.zone(order.name)
  await p.write(zone, await p.attach(order.name, order.serves, order.space))
  await p.graph.apply([{
    entity: { eid },
    domain_registered: {
      at: iso(p),
      ...r.expires ? { expires: r.expires } : {},
    },
  }])
  return { done: 'registered', name: order.name, expires: r.expires }
}

/** Every name a space bought that the registry holds, renewing while its
 * plan pays and not once it doesn't. Answers the names it set. */
export let renew = async (p: Ports, space: string): Promise<string[]> => {
  let held = await p.graph.read(
    line`.domain_registered&.domain_order.space=${space}`,
  )
  let renewed = []
  for (let row of held) {
    let name = await renewOrder(p, row.entity.eid)
    if (name) renewed.push(name)
  }
  return renewed
}

/** Reconcile with the current owner even if a move or plan change happened
 * while the registrar was answering a previous request. */
export let renewOrder = async (
  p: Ports,
  eid: string,
): Promise<string | null> => {
  let read = async () => {
    let [row] = await p.graph.read(line`.entity.eid=${eid}`)
    let order = row?.domain_registered && row.domain_order as Placed | undefined
    return order ? { name: order.name, on: await p.paying(order.space) } : null
  }
  let want = await read()
  while (want) {
    await p.registry.renewing(want.name, want.on)
    let next = await read()
    if (!next || next.on == want.on) return want.name
    want = next
  }
  return null
}

/** Dollars from cents, as a person reads a price.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals([dollars(1044), dollars(1200)], ['$10.44', '$12'])
 * ```
 */
export let dollars = (cents: number): string =>
  `$${cents % 100 ? (cents / 100).toFixed(2) : cents / 100}`

/** The most a name may cost to renew a year, in cents, to be sold here.
 * Its renewal comes with the space's paid plan, and above this it would
 * cost more than a plan brings in. */
export let RENEWS_AT_MOST = 3000

/** An offer as it is sold here: one that renews above {@link RENEWS_AT_MOST}
 * is not registrable, `domain_renews_high`.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let io = { name: 'ada.io', registrable: true, cents: 3200, renews: 5000 }
 * assertEquals(sold(io), { ...io, registrable: false, reason: 'domain_renews_high' })
 * let com = { name: 'ada.com', registrable: true, cents: 1117, renews: 1117 }
 * assertEquals(sold(com), com)
 * ```
 */
export let sold = (o: Offer): Offer =>
  o.registrable && o.currency && o.currency != 'USD'
    ? { ...o, registrable: false, reason: 'unsupported_currency' }
    : o.registrable && (o.renews ?? o.cents ?? 0) > RENEWS_AT_MOST
    ? { ...o, registrable: false, reason: 'domain_renews_high' }
    : o

/** Why a name can't be bought here, as a person reads it. */
let REASONS: Record<string, string> = {
  domain_unavailable: 'taken',
  unsupported_currency: 'not available in US dollars',
  domain_premium: 'a premium name, not sold here',
  domain_renews_high: 'costs more to renew than a plan includes',
  extension_not_supported_via_api: 'its ending is not sold here yet',
  extension_not_supported: 'its ending is not sold here',
  extension_disallows_registration: 'its ending takes no new names',
}

export let unavailable = (o: Offer): string =>
  REASONS[o.reason ?? ''] ?? 'not for sale'

/** An offer as one line an agent reads out: the name and what its first year
 * costs (later years come with the plan), or why it can't be bought.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals(
 *   offerLine({ name: 'ada.com', registrable: true, cents: 1117, renews: 1117 }),
 *   'ada.com — $11.17 for the first year, $11.17 per year to renew',
 * )
 * assertEquals(
 *   offerLine({ name: 'x.com', registrable: false, reason: 'domain_unavailable' }),
 *   'x.com — taken',
 * )
 * ```
 */
export let offerLine = (o: Offer): string =>
  !o.registrable || o.cents == null
    ? `${o.name} — ${unavailable(o)}`
    : `${o.name} — ${dollars(o.cents)} for the first year` +
      (o.renews == null ? '' : `, ${dollars(o.renews)} per year to renew`)

let LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
let domainName = (name: string) =>
  name.length <= 253 && name.includes('.') &&
  name.split('.').every((part) => LABEL.test(part))

let ENDINGS = ['com', 'net', 'org', 'app', 'dev', 'co']

/** Names to check, with the requested spelling first and the registrar's
 * suggestions after it. The check gives every result its current price. */
export let find = async (
  registry: Registry,
  input: string,
): Promise<Offer[]> => {
  let q = input.trim().toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/[/?#].*$/, '').replace(/\.$/, '')
  if (q.length > 253 || !/^[a-z0-9.\s-]+$/.test(q)) return []
  let [stem, ...ending] = q.split('.')
  let words = stem.trim().split(/\s+/)
  let label = words.join('')
  if (![label, ...ending].every((part) => LABEL.test(part))) return []
  let exact = [
    ...ending.length ? [`${label}.${ending.join('.')}`] : [],
    ...ENDINGS.map((tld) => `${label}.${tld}`),
    ...words.length > 1 ? [`${words.join('-')}.com`] : [],
  ]
  let names = [
    ...new Set([
      ...exact,
      ...(await registry.search(ending.length ? label : q, 10)).map((o) =>
        o.name
      ),
    ]),
  ].filter(domainName).slice(0, 20)
  let checked = new Map(
    (await registry.check(names)).map((o) => [o.name, sold(o)]),
  )
  return names.flatMap((name) => checked.get(name) ?? [])
}
