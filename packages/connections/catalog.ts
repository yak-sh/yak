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
// An offer is only data until someone connects it: the host then writes it as
// an integration (`adopted`), marked `built` because only the host writes
// it, and from then on it is an integration like any other.

import { cmp } from '@yaks/fp'
import type { Listing } from './brokers.ts'
import type { Integration } from './integrations.ts'

/** A service as the catalog offers it: the integration it is or would be,
 * the kinds of service it is, the address of its logo where it has no SVG of
 * its own, and whether it is featured. */
export type Offer = Integration & {
  categories: string[]
  image?: string
  featured?: boolean
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
  built: Integration[],
  listings: Listing[],
  broker: string,
): Offer[] => {
  let by = new Map(listings.map((l) => [l.name, l]))
  let standing = (i: Integration) =>
    by.get(i.broker?.name == broker ? i.broker.integration : i.name) ??
      by.get(i.name)
  let taken = new Set(built.flatMap((i) => [i.name, standing(i)?.name]))
  return [
    ...built.filter((i) => !i.testing).map((i): Offer => {
      let l = standing(i)
      return {
        ...i,
        categories: l?.categories ?? [],
        ...!i.logo && l?.logo ? { image: l.logo } : {},
        featured: true,
      }
    }),
    ...listings.filter((l) => !taken.has(l.name) && l.hosts.length)
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
 * it, so it is `built`. */
export let adopted = (o: Offer, logo?: string): Integration => {
  let { categories: _c, image: _i, featured: _f, ...i } = o
  return { ...i, ...logo ? { logo } : {}, built: true }
}
