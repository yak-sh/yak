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
// anywhere else. An image is kept in the bucket once it is fetched, and only
// an SVG document is: a broker's address can answer a web page (Nango's CDN
// does for a logo it lost), so each address it is kept at is tried in turn,
// and a service none answers for wears its initial until one does.

import {
  adopted,
  BrokerError,
  brokerOf,
  catalogue,
  initialLogo,
  INTEGRATION,
  type Integration,
  integrationEid,
  isSvg,
  type Listing,
  logoSources,
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

// Where the list and its logos are kept, how long the list stands before it
// is asked again, the most of a logo the bucket keeps, and the most an
// integration's row does (a bigger one is drawn from the door).
let KEPT = `platform/catalog/${BROKER}.json`
let LOGOS_KEPT = `platform/catalog/${BROKER}/logos/`
let DAY = 86_400_000
let LOGO_ROOM = 1_000_000
let ROW_ROOM = 100_000

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
    built.filter((i) => i.built || !closed.has(i.name)),
    (kept?.listings ?? []).filter((l) => !closed.has(l.name)),
    BROKER,
  )
}

type Fetch = typeof fetch

// A body that is only another SVG's file name: a link, as GitHub serves a
// symbolic link in a repository (Nango's airtable-pat.svg says airtable.svg).
let LINK = /^[\w.-]+\.svg$/
let HOPS = 3

// The first of `sources` that answers an SVG document small enough to keep,
// a link followed up to `HOPS` times, or what each answered instead.
let fetched = async (sources: string[], fetcher: Fetch) => {
  let answers: string[] = []
  let ask = async (
    at: string,
    hops: number,
  ): Promise<string | undefined> => {
    let res = await fetcher(at, { signal: AbortSignal.timeout(5_000) })
    let text = res.ok ? (await res.text()).trim() : ''
    if (text.length <= LOGO_ROOM && isSvg(text)) return text
    if (hops && LINK.test(text)) return ask(new URL(text, at).href, hops - 1)
    answers.push(`${at}: ${res.status} ${res.headers.get('content-type')}`)
  }
  for (let at of sources.filter((at) => /^https:\/\//.test(at))) {
    try {
      let svg = await ask(at, HOPS)
      if (svg) return { svg }
    } catch (e) {
      answers.push(`${at}: ${e}`)
    }
  }
  return { answers }
}

/** A listing's logo as an SVG document: kept in the bucket, else fetched
 * from the first address that answers one and kept. None where it names no
 * logo, or none answered one, which is ours to hear about. */
export let logoOf = async (
  env: Env,
  l: Pick<Listing, 'name' | 'logo'>,
  fetcher: Fetch = fetch,
): Promise<string | undefined> => {
  if (!l.logo) return undefined
  let key = LOGOS_KEPT + encodeURIComponent(l.name)
  try {
    let kept = await env.BLOBS.get(key)
    if (kept) return new TextDecoder().decode(await kept.arrayBuffer())
  } catch (e) {
    caught(e, { request: 'catalog logo' })
  }
  let { svg, answers } = await fetched(logoSources(l.logo), fetcher)
  if (!svg) {
    caught(new Error('no address answered a catalog logo as an SVG'), {
      request: 'catalog logo',
      service: l.name,
      answers: answers?.join('; '),
    })
    return undefined
  }
  try {
    await env.BLOBS.put(key, svg)
  } catch (e) {
    caught(e, { request: 'catalog logo' })
  }
  return svg
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
  let svg = o.image ? await logoOf(env, { name, logo: o.image }) : undefined
  let i = adopted(o, svg && svg.length <= ROW_ROOM ? svg : undefined)
  await meta(env).apply([{
    entity: { eid: integrationEid(name) },
    [INTEGRATION]: i,
    // Refused, rather than written over, where one was made meanwhile.
    $was: { [INTEGRATION]: { built: null, owner: null } },
  }], KERNEL)
  return i
}

/** A card's logo, as the broker's list names it, or the service's initial
 * where no address answers one: drawn as an image that runs nothing, and kept
 * by the browser for a week, the initial only for an hour. A 404 for a name
 * the list doesn't hold; null for any other path. */
export let logoDoor = async (
  env: Env,
  path: string,
  fetcher: Fetch = fetch,
) => {
  if (!path.startsWith(LOGOS)) return null
  let name = decodeURIComponent(path.slice(LOGOS.length))
  let l = (await listingsOf(env))?.listings.find((l) => l.name == name)
  if (!l) return new Response(null, { status: 404 })
  let svg = await logoOf(env, l, fetcher)
  return new Response(svg ?? initialLogo(l.title), {
    headers: {
      'content-type': 'image/svg+xml',
      'cache-control': `public, max-age=${svg ? 604800 : 3600}`,
      'content-security-policy':
        "default-src 'none'; style-src 'unsafe-inline'",
      'x-content-type-options': 'nosniff',
    },
  })
}
