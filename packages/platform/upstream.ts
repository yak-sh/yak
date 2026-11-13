// Something shared on the platform that someone outside it wrote, and what
// its licence lets the platform do with it: `upstream{source, author, commit,
// licence, notice}`. A permissive licence lets the platform host a copy, its
// notice kept with it; no licence, or any other, lets it list a link to the
// source and nothing of the text.

/** Where something shared came from when someone outside the platform wrote
 * it, as `upstream{…}` holds it. */
export type Upstream = {
  source: string
  author?: string
  commit?: string
  licence?: string
  notice?: string
}

// The licences that let anyone keep a copy with its notice, by SPDX id or
// usual name, folded to letters and digits: "Apache License 2.0" folds to
// apache20, as Apache-2.0 does.
let COPYABLE: Set<string> = new Set([
  'mit',
  'apache20',
  'apacheversion20',
  'bsd2clause',
  'bsd3clause',
  'isc',
  '0bsd',
  'cc010',
  'unlicense',
])

let folded = (licence: string): string =>
  licence.toLowerCase().replace(/\blicen[cs]e\b/g, '').replace(/[^a-z0-9]/g, '')

/** Whether `licence` lets the platform host a copy of someone else's text. */
export let hostable = (licence = ''): boolean => COPYABLE.has(folded(licence))

/** Whether a shared thing is only a link: someone else's, under a licence
 * that allows no copy. */
export let linked = (s: { upstream: Upstream | null }): boolean =>
  !!s.upstream && !hostable(s.upstream.licence)

let FIELDS = ['source', 'author', 'commit', 'licence', 'notice'] as const

/** An upstream as read from a row: only the properties it holds, in one
 * order, or null when it names no source. */
export let upstreamOf = (u?: Partial<Upstream> | null): Upstream | null =>
  u?.source
    ? Object.fromEntries(
      FIELDS.flatMap((k) => u[k] ? [[k, u[k]]] : []),
    ) as Upstream
    : null

/** Who wrote it, where, and under what, as one clause. */
export let credit = (up: Upstream): string =>
  `by ${up.author}, from ${up.source} at ${up.commit}, ` +
  (up.licence ? `under ${up.licence}` : 'with no licence')
