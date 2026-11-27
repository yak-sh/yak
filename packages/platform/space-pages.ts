/**
 * What a space's Settings, Domains and Trash pages (./space-pages-view.ts)
 * are drawn from, as the tab's page graph holds it (D-475 step 5), and what
 * they write there:
 *
 * - `spaceSettings{space, slug, title, home, byline, paying, included,
 *   logo}`: the space's name, address, what its address opens, the line at
 *   the foot of its pages, whether its plan is paid and includes domains,
 *   and where its logo is drawn from.
 * - `ownedDomain{space, rank, name, …}`: each domain the space holds or
 *   ordered, as its Domains page lists it (./domain-pages.ts `Domain`).
 * - `binned{space, rank, item, kind, name, monthly}`: each app and phone
 *   number in its trash.
 *
 * The directory answers each as a read of the person, for a space they own
 * (graph.ts `/person/ws`). The apps a page names are the side's
 * (./side-rows.ts `sideApps`).
 *
 * A domain search's offers are no store's: one row, `domainSearch{asked,
 * query, offers, error}`, answers `domainOffers(query)`, read from
 * the registrar by the page graph's door.
 *
 * The page writes through the graph: a `spaceSettings` row naming the space
 * and what it changes (`logo: null` takes the logo off), and the acts
 * `restoreBinned{space, item}`, `pointDomain{space, name, destination}`,
 * `chooseDomain{space, name}` and `offerDomain{space, name, to}`. The door
 * does each as the person and answers what it came to, with `said` where a
 * sentence says it.
 *
 * @module
 */
import type { Bundle } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import type { VocabDoc } from '@yaks/vocab'
import type { Domain, DomainOffer } from './domain-pages.ts'
import spacePagesJson from './vocab/space-pages.vocab.json' with {
  type: 'json',
}

/** A space as its Settings page says it. */
export type SpaceSettings = {
  slug: string
  title: string
  /** The slug of the app its address opens; '' for its library. */
  home: string
  byline: boolean
  paying: boolean
  /** Whether its plan includes buying and attaching domains. */
  included: boolean
  logo?: string
}

/** What a write of a space's settings changes; `logo: null` takes it off. */
export type SettingsWrite =
  & Partial<
    Pick<SpaceSettings, 'slug' | 'title' | 'home' | 'byline'>
  >
  & { logo?: null }

/** An app or a phone number in a space's trash. */
export type Binned = {
  item: string
  kind: 'app' | 'number'
  name: string
  /** What a number still costs a month. */
  monthly?: string
}

let line = (word: string) => {
  let at = `.${word}.space=`
  return {
    of: (eid: string) => at + eid,
    space: (asked: string) =>
      asked.startsWith(at) ? asked.slice(at.length) : undefined,
  }
}

let settings = line('spaceSettings')
let trash = line('binned')
let domains = line('ownedDomain')

/** The settings of the space `eid`. */
export let spaceSettings = settings.of

/** The trash of the space `eid`. */
export let spaceTrash = trash.of

/** The domains of the space `eid`. */
export let spaceDomains = domains.of

/** What a line of a space's pages asks: which page of which space;
 * undefined for another line. */
export let spaceLine = (
  asked: string,
): { page: 'settings' | 'trash' | 'domains'; space: string } | undefined => {
  let s = settings.space(asked)
  if (s) return { page: 'settings', space: s }
  let t = trash.space(asked)
  if (t) return { page: 'trash', space: t }
  let d = domains.space(asked)
  return d ? { page: 'domains', space: d } : undefined
}

let OFFERS = '.domainSearch.asked='

// A search as a line's value: the hex of its UTF-8, which no query word
// reads as anything but letters and digits.
let hex = (text: string) =>
  [...new TextEncoder().encode(text)]
    .map((b) => b.toString(16).padStart(2, '0')).join('')
let unhex = (code: string) =>
  new TextDecoder().decode(
    new Uint8Array(code.match(/../g)?.map((b) => parseInt(b, 16)) ?? []),
  )

/** The domains offered for `query`, read from the registrar. */
export let domainOffers = (query: string): string => OFFERS + hex(query)

/** What a `domainOffers` line searches for, or undefined for another line. */
export let offersQuery = (asked: string): string | undefined =>
  asked.startsWith(OFFERS) &&
    /^(?:[0-9a-f]{2})+$/.test(asked.slice(OFFERS.length))
    ? unhex(asked.slice(OFFERS.length))
    : undefined

export let spacePagesWords: VocabDoc = spacePagesJson as VocabDoc

// A property the row has no word on is left out, as the graph keeps it.
let drop = <T extends Record<string, unknown>>(o: T): T =>
  Object.fromEntries(
    Object.entries(o).filter(([, v]) => v !== undefined && v !== null),
  ) as T

/** The eid of the settings row of the space `space`. */
export let settingsEid = (space: string): string =>
  derivedEid(`spaceSettings|${space}`)

/** The settings of the space `space`, as a row. */
export let settingsRow = (space: string, s: SpaceSettings): Bundle => ({
  entity: { eid: settingsEid(space) },
  spaceSettings: drop({ space, ...s }),
})

/** The domains of the space `space`, as rows, in the order listed. */
export let domainRows = (space: string, all: Domain[]): Bundle[] =>
  all.map((d, rank) => ({
    entity: { eid: derivedEid(`ownedDomain|${space}|${d.name}`) },
    ownedDomain: drop({ space, rank, ...d }),
  }))

/** The trash of the space `space`, as rows, in the order listed. */
export let binnedRows = (space: string, all: Binned[]): Bundle[] =>
  all.map((b, rank) => ({
    entity: { eid: derivedEid(`binned|${space}|${b.item}`) },
    binned: drop({ space, rank, ...b }),
  }))

/** What a search for `query` came to, as its row: its offers, or none and
 * why. */
export let offerRows = (
  query: string,
  offers: DomainOffer[],
  error?: string,
): Bundle[] => [{
  entity: { eid: derivedEid(`domainSearch|${query}`) },
  domainSearch: drop({
    asked: hex(query),
    query,
    offers: offers.map((o) => drop(o)),
    error,
  }),
}]

let ranked = <T extends { rank: number }>(rows: Bundle[], comp: string) =>
  rows.flatMap((r) => r[comp] ? [r[comp] as T] : [])
    .sort((a, b) => a.rank - b.rank)

/** The settings `rows` hold, if any. */
export let settingsOf = (rows: Bundle[]): SpaceSettings | undefined => {
  let row = rows.find((r) => r.spaceSettings)?.spaceSettings as
    | (SpaceSettings & { space: string })
    | undefined
  if (!row) return undefined
  let { space: _, ...s } = row
  return s
}

/** The domains `rows` hold, in the order listed. */
export let domainsOf = (rows: Bundle[]): Domain[] =>
  ranked<Domain & { space: string; rank: number }>(rows, 'ownedDomain')
    .map(({ space: _, rank: _r, ...d }) => d)

/** The trash `rows` hold, in the order listed. */
export let binnedOf = (rows: Bundle[]): Binned[] =>
  ranked<Binned & { space: string; rank: number }>(rows, 'binned')
    .map(({ space: _, rank: _r, ...b }) => b)

/** What a search `rows` answer came to: its offers, or why there are none;
 * undefined until it answered. */
export let offersOf = (
  rows: Bundle[],
): { found: DomainOffer[]; error?: string } | undefined => {
  let search = rows.find((r) => r.domainSearch)?.domainSearch as
    | { offers: DomainOffer[]; error?: string }
    | undefined
  return search && { found: search.offers, error: search.error }
}

let WRITES = [
  'spaceSettings',
  'restoreBinned',
  'pointDomain',
  'chooseDomain',
  'offerDomain',
]

/** The space `bundles` write to, when each is a write of one space's pages;
 * else undefined. */
export let spaceWrite = (bundles: Bundle[]): string | undefined => {
  let spaces = new Set(
    bundles.map((b) => {
      let word = WRITES.find((w) => w in b)
      return word && (b[word] as { space?: string }).space
    }),
  )
  let [space] = spaces
  return bundles.length && spaces.size == 1 && space ? space : undefined
}
