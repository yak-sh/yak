// The catalog the connections page offers (@yaks/connections `catalogue`):
// the built integrations, and every service Nango lists that a connection
// here can use. The person sees each service, never who brokers it.
//
// Nango's list is data: asked of the broker (its `catalog`), kept in the
// bucket for every isolate to read, and held by each isolate once read. One
// older than a day is asked again behind the answer, so no page waits on the
// broker but the first one after nothing was kept. A search is of the list in
// memory, so it costs no read at all.
//
// A service is only an offer until someone connects it (`adopting`): the
// broker is made ready to sign people in to it, its logo fetched, and it is
// written as a built integration, which every verb then treats like any
// other. A service the broker refuses to make ready (Nango has no app of its
// own with it) is closed: kept beside the list, and offered no more.
//
// A card's logo is the broker's image, served through our own door
// (`logoDoor`) so the page names only yaks.app and loads nothing from
// anywhere else.

import {
  adopted,
  BrokerError,
  brokerOf,
  catalogue,
  INTEGRATION,
  type Integration,
  integrationEid,
  type Listing,
  type Offer,
} from '@yaks/connections'
import { background, caught } from './defects.ts'
import type { Env } from './env.ts'
import { refuse } from './tool.ts'
import { vaultOf } from './vault.ts'
import { KERNEL, meta } from './meta.ts'

/** The broker whose catalog is offered. */
export let BROKER = 'nango'

/** Where a card's logo is served: this and the service's name. */
export let LOGOS = '/connections/logo/'

// Where the list is kept, how long it stands before it is asked again, and
// the most of a logo that is kept.
let KEPT = `platform/catalog/${BROKER}.json`
let DAY = 86_400_000
let LOGO_ROOM = 100_000

/** The broker's list as it was kept: when it was asked, what it listed, and
 * the services it refused to make ready. */
export type Kept = { at: number; listings: Listing[]; closed: string[] }

// This isolate's copy, and the read under way, for each bucket it is kept in.
let held = new WeakMap<object, Kept>()
let reading = new WeakMap<object, Promise<Kept | undefined>>()

let keep = async (env: Env, kept: Kept) => {
  await env.BLOBS.put(KEPT, JSON.stringify(kept))
  held.set(env.BLOBS, kept)
  return kept
}

// The list asked of the broker and kept, or none while its key is not.
let asked = async (env: Env): Promise<Kept | undefined> => {
  let broker = await brokerOf(vaultOf(env), BROKER)
  if (!broker) return undefined
  let listings = await broker.catalog()
  let closed = held.get(env.BLOBS)?.closed ?? []
  return keep(env, { at: Date.now(), listings, closed })
}

let stored = async (env: Env): Promise<Kept | undefined> => {
  let b = await env.BLOBS.get(KEPT)
  return b
    ? JSON.parse(new TextDecoder().decode(await b.arrayBuffer())) as Kept
    : undefined
}

// One read at a time in an isolate: a page drawn while it is under way waits
// on the same one.
let once = (env: Env, read: () => Promise<Kept | undefined>) => {
  let under = reading.get(env.BLOBS)
  if (under) return under
  let now = read().finally(() => reading.delete(env.BLOBS))
  reading.set(env.BLOBS, now)
  return now
}

/** The broker's list: this isolate's copy, else the one kept, else asked of
 * the broker; none where its key is not kept or nothing could be read, which
 * is ours to hear about. */
export let listingsOf = async (env: Env): Promise<Kept | undefined> => {
  if (!held.has(env.BLOBS)) {
    try {
      let kept = await once(
        env,
        async () => await stored(env) ?? await asked(env),
      )
      if (kept) held.set(env.BLOBS, kept)
    } catch (e) {
      caught(e, { request: 'catalog' })
    }
  }
  let kept = held.get(env.BLOBS)
  if (kept && Date.now() - kept.at > DAY && !reading.has(env.BLOBS)) {
    background(
      once(env, () => asked(env)).then(
        () => {},
        (e) => caught(e, { request: 'catalog' }),
      ),
    )
  }
  return kept
}

/** Every offer, given the built integrations the directory holds. */
export let offersOf = async (
  env: Env,
  built: Integration[],
): Promise<Offer[]> => {
  let kept = await listingsOf(env)
  let closed = new Set(kept?.closed ?? [])
  return catalogue(
    built,
    (kept?.listings ?? []).filter((l) => !closed.has(l.name)),
    BROKER,
  )
}

// A logo as an SVG document, kept with the integration it marks; none where
// it is not one, or is too big to keep.
let svgOf = async (at: string): Promise<string | undefined> => {
  if (!/^https:\/\//.test(at)) return undefined
  try {
    let res = await fetch(at, { signal: AbortSignal.timeout(5_000) })
    let text = res.ok ? await res.text() : ''
    return text.length <= LOGO_ROOM && /<svg[\s>]/.test(text) ? text : undefined
  } catch (e) {
    caught(e, { request: 'catalog logo' })
    return undefined
  }
}

/**
 * The integration an offer named `name` is written as, once someone connects
 * it: the broker made ready for one it signs in to, its logo fetched, and the
 * row written by the host. Nothing for a name the catalog doesn't offer, or
 * one already an integration. A service the broker refuses is closed, and
 * the person told it can't be connected yet.
 */
export let adopting = async (
  env: Env,
  offers: Offer[],
  name: string,
): Promise<Integration | undefined> => {
  let o = offers.find((o) => o.name == name && !o.built)
  if (!o) return undefined
  if (o.broker) {
    let broker = await brokerOf(vaultOf(env), o.broker.name)
    if (!broker) {
      throw new Error(`no key is kept for the ${o.broker.name} broker`)
    }
    let kept = await listingsOf(env)
    let l = kept?.listings.find((l) => l.name == o.broker!.integration)
    try {
      await broker.enable(o.broker.integration, l?.connects ?? 'signin')
    } catch (e) {
      if (!(e instanceof BrokerError && e.refused)) throw e
      if (kept) await keep(env, { ...kept, closed: [...kept.closed, name] })
      throw refuse('integration', `${o.title} can't be connected yet.`)
    }
  }
  let i = adopted(o, o.image ? await svgOf(o.image) : undefined)
  await meta(env).apply([{
    entity: { eid: integrationEid(name) },
    [INTEGRATION]: i,
    // Refused, rather than written over, where one was made meanwhile.
    $was: { [INTEGRATION]: { name: null } },
  }], KERNEL)
  return i
}

/** A card's logo, as the broker's list names it: kept by the browser for a
 * week, and drawn as an image that runs nothing.
 * Null for any other path. */
export let logoDoor = async (env: Env, path: string) => {
  if (!path.startsWith(LOGOS)) return null
  let name = decodeURIComponent(path.slice(LOGOS.length))
  let at = (await listingsOf(env))?.listings.find((l) => l.name == name)?.logo
  let res = at && /^https:\/\//.test(at)
    ? await fetch(at, { signal: AbortSignal.timeout(5_000) })
    : undefined
  if (!res?.ok) return new Response(null, { status: 404 })
  return new Response(res.body, {
    headers: {
      'content-type': 'image/svg+xml',
      'cache-control': 'public, max-age=604800',
      'content-security-policy':
        "default-src 'none'; style-src 'unsafe-inline'",
      'x-content-type-options': 'nosniff',
    },
  })
}
