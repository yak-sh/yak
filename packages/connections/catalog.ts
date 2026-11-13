// The catalog: every service a person can be offered, whether or not anything
// is connected to it yet. It is the built integrations (./integrations.ts)
// and every service a broker lists (./brokers.ts `catalog`), as one list of
// offers, each the integration it would be once someone connects it.
//
// Direct comes first. A built integration stands in for the broker's listing
// of the same service: one by its name, and one whose broker is the listing
// (Gmail for Nango's google-mail). A listing reached with a key is direct
// too: the key is kept here and sent only to the listing's hosts, so the
// broker is never asked. Only a service signed in to through the broker's
// own app, or with a client of the person's own, is brokered. A listing whose
// hosts depend on the account names none, and is left out until it can say
// them.
//
// Every offer can have its own integration row before anyone connects it.
// Connecting marks it built only once its broker is ready (`adopted`).

import { cmp } from '@yaks/fp'
import type { Listing } from './brokers.ts'
import type { Integration, Marked } from './integrations.ts'

/** A service as the catalog offers it: the integration it is or would be,
 * the kinds of service it is, the address of its logo where it has no SVG of
 * its own, and whether it is featured. */
export type Offer = Marked & {
  categories: string[]
  image?: string
}

// A kind of service as a person reads it: "crm" as CRM, "dev-tools" as Dev
// tools.
let WORDS: Record<string, string> = {
  crm: 'CRM',
  hr: 'HR',
  ats: 'Hiring',
  erp: 'ERP',
  iam: 'Identity',
  cms: 'CMS',
}

/// kind('dev-tools') -> 'Dev tools'
/// kind('crm') -> 'CRM'
export let kind = (category: string): string =>
  WORDS[category] ??
    category.charAt(0).toUpperCase() + category.slice(1).replaceAll('-', ' ')

/** The integration a broker's listing would be: brokered where it is signed
 * in to through the broker, a pasted key where it is reached with one. */
export let offerOf = (l: Listing, broker: string): Offer => ({
  name: l.name,
  title: l.title,
  tagline: l.categories.slice(0, 3).map(kind).join(' · '),
  hosts: l.hosts,
  connects: l.connects,
  ...l.connects == 'key'
    ? {
      ...l.fields ? { fields: l.fields } : {},
      ...l.instructions ? { instructions: l.instructions } : {},
    }
    : { broker: { name: broker, integration: l.name } },
  categories: l.categories,
  ...l.logo ? { image: l.logo } : {},
  ...l.popular ? { featured: true } : {},
})

/** The catalog: the built integrations a person may be offered unasked (none
 * in its service's testing mode), each featured, and every listing of
 * `broker` that no built one stands in for and that names its hosts, featured
 * where the broker features it, by title. A built integration takes the kinds
 * of the listing it stands in for. */
export let catalogue = (
  integrations: Marked[],
  listings: Listing[],
  broker: string,
): Offer[] => {
  let built = integrations.filter((i) => i.built)
  let by = new Map(listings.map((l) => [l.name, l]))
  let standing = (i: Integration) =>
    by.get(i.broker?.name == broker ? i.broker.integration : i.name) ??
      by.get(i.name)
  let taken = new Set(built.flatMap((i) => [i.name, standing(i)?.name]))
  let pending = integrations.filter((i) =>
    !i.built && !i.owner && !i.testing && i.hosts.length &&
    Array.isArray(i.categories) && !taken.has(i.name)
  ).map((i): Offer => ({ ...i, categories: i.categories ?? [] }))
  let described = new Set(pending.map((i) => i.name))
  return [
    ...built.filter((i) => !i.testing).map((i): Offer => {
      let l = standing(i)
      return {
        ...i,
        categories: i.categories ?? l?.categories ?? [],
        ...!i.logo && !i.image && l?.logo ? { image: l.logo } : {},
        featured: true,
      }
    }),
    ...pending,
    ...listings.filter((l) =>
      !taken.has(l.name) && !described.has(l.name) && l.hosts.length
    )
      .map((l) => offerOf(l, broker)),
  ].sort((a, b) =>
    cmp((a.title || a.name).toLowerCase(), (b.title || b.name).toLowerCase())
  )
}

// How well an offer answers one word: its title starting with it, a word of
// its title starting with it, its name or kinds holding it, or not at all.
let fit = (o: Offer, word: string): number => {
  let title = (o.title || o.name).toLowerCase()
  if (title.startsWith(word)) return 3
  if (title.split(/[^a-z0-9]+/).some((w) => w.startsWith(word))) return 2
  return [o.name, ...o.categories, ...o.categories.map(kind), o.tagline ?? '']
      .some((t) => t.toLowerCase().includes(word))
    ? 1
    : 0
}

/** The offers that hold every word of `words`, best first: by how well each
 * word fits, then featured, then by title. No words is every offer. */
export let find = (offers: Offer[], words: string): Offer[] => {
  let terms = words.toLowerCase().split(/\s+/).filter(Boolean)
  return offers
    .map((o) => ({ o, score: terms.map((t) => fit(o, t)) }))
    .filter(({ score }) => score.every((s) => s > 0))
    .sort((a, b) =>
      b.score.reduce((n, s) => n + s, 0) - a.score.reduce((n, s) => n + s, 0) ||
      Number(!!b.o.featured) - Number(!!a.o.featured)
    )
    .map(({ o }) => o)
}

/** The kinds of service the catalog holds, the most common first. */
export let kinds = (offers: Offer[]): string[] => {
  let n = new Map<string, number>()
  for (let c of offers.flatMap((o) => o.categories)) {
    n.set(c, (n.get(c) ?? 0) + 1)
  }
  return [...n].sort((a, b) => b[1] - a[1] || cmp(a[0], b[0])).map(([c]) => c)
}

/** The integration an offer is written as once someone connects it, with
 * its logo as an SVG document where one was fetched: only the host writes
 * it, so it is `built`. Whether it is featured is the platform's mark, never
 * the integration's own word. */
export let adopted = (o: Offer, logo?: string): Integration => {
  let { featured: _, ...i } = o
  return { ...i, ...logo ? { logo } : {}, built: true }
}

// What may stand before an SVG document's root: a byte-order mark, space, an
// XML declaration, comments and its doctype.
let PROLOG =
  /^(?:\uFEFF|\s|<\?xml[^>]*\?>|<!--[\s\S]*?-->|<!DOCTYPE svg[^>]*>)*/i

/** Whether `text` is an SVG document: its root is `<svg>`. A page that holds
 * an SVG is not one. */
/// isSvg('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"/>') -> true
/// isSvg('<!-- drawn --><svg><path/></svg>') -> true
/// isSvg('<!doctype html><html><body><svg></svg></body></html>') -> false
export let isSvg = (text: string): boolean =>
  /^<svg[\s>/]/.test(text.replace(PROLOG, ''))

let XML: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;' }

/** The logo a service with no image of its own wears: the first letter of
 * its title on a rounded square, as an SVG document. */
export let initialLogo = (title: string): string => {
  let first = ([...title.trim()][0] ?? '?').toUpperCase()
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' +
    '<rect width="24" height="24" rx="6" fill="#8882"/>' +
    '<text x="12" y="16.5" text-anchor="middle" font-size="13" ' +
    'font-family="system-ui,sans-serif" font-weight="600" fill="#888">' +
    `${first.replace(/[&<>]/g, (c) => XML[c])}</text></svg>`
}
