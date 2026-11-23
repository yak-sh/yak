// Cloudflare Registrar, as its API (beta since 2026-04) offers it: names
// searched and checked with their price, a name registered in the account and
// its workflow read until it ends, renewal turned on or off, and the zone that
// serves a registered name's DNS. Cloudflare charges the account's default
// payment method at cost, a registration that succeeded is never refunded,
// and a domain it registers uses its nameservers, so its DNS is a zone in the
// same account. Renewal has no call of its own yet: `auto_renew` is it,
// charged up to 30 days before the name expires.
//
// It is a registry as @yaks/domains asks for one (`registry`).
//
// developers.cloudflare.com/api/resources/registrar
import type { Offer, Registration, Registry, State } from '@yaks/domains'
import { type Account, accountUrl, answered, resent } from './api.ts'

/** The account a registrar call reaches, and a token that may register there,
 * create zones and edit their DNS. */
export type Registrar = Account & { token: string }

type Priced = {
  name: string
  registrable: boolean
  reason?: string
  pricing?: {
    currency: string
    registration_cost: string
    renewal_cost: string
  }
}

type Workflow = {
  domain_name: string
  state: State
  completed?: boolean
  error?: { code?: string; message?: string }
  context?: { registration?: { expires_at?: string } }
}

/** Dollars written as Cloudflare writes them, in whole cents, rounded up so
 * a price is never under what the account is charged.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals([cents('10.44'), cents('9.155'), cents('12')], [1044, 916, 1200])
 * ```
 */
export let cents = (dollars: string) => Math.ceil(Number(dollars) * 100 - 1e-6)

/** An offer as this package says it, from Cloudflare's own.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals(
 *   offer({
 *     name: 'ada.com',
 *     registrable: true,
 *     pricing: { currency: 'USD', registration_cost: '10.44', renewal_cost: '10.44' },
 *   }),
 *   { name: 'ada.com', registrable: true, cents: 1044, renews: 1044, currency: 'USD' },
 * )
 * assertEquals(
 *   offer({ name: 'x.com', registrable: false, reason: 'domain_unavailable' }),
 *   { name: 'x.com', registrable: false, reason: 'domain_unavailable' },
 * )
 * ```
 */
export let offer = (p: Priced): Offer => ({
  name: p.name,
  registrable: p.registrable && !!p.pricing,
  ...p.pricing
    ? {
      cents: cents(p.pricing.registration_cost),
      renews: cents(p.pricing.renewal_cost),
      currency: p.pricing.currency,
    }
    : {},
  ...p.reason ? { reason: p.reason } : {},
})

let workflow = (w: Workflow): Registration => ({
  name: w.domain_name,
  state: w.state,
  ...w.context?.registration?.expires_at
    ? { expires: w.context.registration.expires_at }
    : {},
  ...w.error ? { error: w.error.message ?? w.error.code ?? 'failed' } : {},
})

let root = (r: Registrar, path: string) =>
  `${r.WORKERS_API ?? 'https://api.cloudflare.com/client/v4'}${path}`

let call = async (
  r: Registrar,
  url: string,
  init: RequestInit = {},
  idempotent?: boolean,
) =>
  await answered(
    await resent(url, {
      ...init,
      headers: {
        authorization: `Bearer ${r.token}`,
        ...init.body ? { 'content-type': 'application/json' } : {},
      },
    }, idempotent == null ? {} : { idempotent }),
  )

// What a read finds, or null where Cloudflare has nothing by that name.
let found = async <T>(read: Promise<unknown>): Promise<T | null> => {
  try {
    return await read as T
  } catch (e) {
    if ((e as { status?: number }).status == 404) return null
    throw e
  }
}

let registrar = (r: Registrar, path: string) =>
  accountUrl(r, `/registrar${path}`)

/** Names Cloudflare suggests for a query, with or without an extension. Its
 * answers come from a cache, so {@link check} says what is true now. */
export let search = async (r: Registrar, q: string, limit = 10) =>
  (await call(
    r,
    registrar(r, `/domain-search?q=${encodeURIComponent(q)}&limit=${limit}`),
  ) as { domains: Priced[] }).domains.map(offer)

/** Whether each name can be registered now, and its price: at most 20. */
export let check = async (r: Registrar, names: string[]) =>
  (await call(r, registrar(r, '/domain-check'), {
    method: 'POST',
    body: JSON.stringify({ domains: names }),
  }, true) as { domains: Priced[] }).domains.map(offer)

/** Register a name in the account, charged to its default payment method,
 * with renewal on or off and the registrant's contact redacted. Answers
 * where its workflow stands, which may still be running. Sent once: a
 * registration that answered nothing may still have happened, so its caller
 * reads {@link registration} before asking again. */
export let register = async (r: Registrar, name: string, renew: boolean) =>
  workflow(
    await call(r, registrar(r, '/registrations'), {
      method: 'POST',
      body: JSON.stringify({
        domain_name: name,
        auto_renew: renew,
        privacy_mode: 'redaction',
      }),
    }) as Workflow,
  )

/** Where a name's registration workflow stands, or null where this account
 * never asked to register it. */
export let registration = async (r: Registrar, name: string) => {
  let w = await found<Workflow>(
    call(
      r,
      registrar(
        r,
        `/registrations/${encodeURIComponent(name)}/registration-status`,
      ),
    ),
  )
  return w && workflow(w)
}

/** Turn a registered name's renewal on or off. On, Cloudflare charges the
 * account up to 30 days before it expires and renews it a year. */
export let renewing = async (r: Registrar, name: string, on: boolean) => {
  await call(r, registrar(r, `/registrations/${encodeURIComponent(name)}`), {
    method: 'PATCH',
    body: JSON.stringify({ auto_renew: on }),
  }, true)
}

/** The id of the account's zone for a name, made where there is none yet. A
 * name Cloudflare registered answers on its nameservers, and this zone is
 * what they serve. */
export let zone = async (r: Registrar, name: string) => {
  let held = async () =>
    (await call(
      r,
      root(
        r,
        `/zones?name=${encodeURIComponent(name)}&account.id=${r.CF_ACCOUNT}`,
      ),
    ) as { id: string; name: string }[]).find((z) => z.name == name)?.id
  let id = await held()
  if (id) return id
  try {
    return (await call(r, root(r, '/zones'), {
      method: 'POST',
      body: JSON.stringify({
        name,
        account: { id: r.CF_ACCOUNT },
        type: 'full',
      }),
    }) as { id: string }).id
  } catch (e) {
    // One made between the look and the make is the zone that was asked for.
    let made = await held()
    if (made) return made
    throw e
  }
}

/** The account's registrar as @yaks/domains asks for a registry. */
export let registry = (r: Registrar): Registry => ({
  search: (q, limit) => search(r, q, limit),
  check: (names) => check(r, names),
  register: (name, renew) => register(r, name, renew),
  registration: (name) => registration(r, name),
  renewing: (name, on) => renewing(r, name, on),
  zone: (name) => zone(r, name),
})
