// Where an app stands in the gallery, read off its row, and where its own page
// is: what a space's page shows of the gallery, apart from gallery.ts so a page
// that only serves a space never compiles the gallery's pages and letters
// (T-148886).
import type { Shared } from './directory.ts'
import { type Host, url as siteUrl } from '@yaks/platform/host'
import { h } from 'preact'

// Where each published app's own page lives (app-page.ts): one address per
// platform-wide name, listed or not.
export let PAGE = '/apps/'
export let pageAt = (name: string, env: Host = {}) =>
  siteUrl(env, `${PAGE}${encodeURIComponent(name)}`)

/** How many other spaces installed a copy of something shared, said as a
 * line: what its maker is credited with (T-131912). */
export let installedBy = (n: number) =>
  `Installed by ${n} other ${n == 1 ? 'space' : 'spaces'}`

/** What yaks.app says of something shared, wherever it is listed, to a
 * person and to an agent alike (T-160642): when we reviewed it and which
 * version, how many other spaces installed it, and whether we feature it or
 * the space that shares it. Counted and read, never stored. */
export type Reputation = {
  reviewed: { at: string; version?: number } | null
  installs: number
  featured: boolean
}

export let reputation = (
  shared: Pick<Shared, 'gallery' | 'featured'>,
  installs: number,
  publisher?: { featured?: boolean },
): Reputation => {
  let g = shared.gallery
  return {
    reviewed: g?.decision == 'approved' && g.listedAt && g.reviewedAt
      ? {
        at: g.reviewedAt,
        ...g.version != null ? { version: g.version } : {},
      }
      : null,
    installs,
    featured: !!shared.featured || !!publisher?.featured,
  }
}

/** A reputation as the few short phrases a card, a page and a tool's answer
 * all say, in that order. */
/// reputed({ reviewed: { at: '2026-11-13T10:00:00Z', version: 3 }, installs: 2, featured: true })
///   -> ['Featured by yaks.app', 'Reviewed by yaks.app on 2026-11-13, version 3', 'Installed by 2 other spaces']
/// reputed({ reviewed: null, installs: 1, featured: false }) -> ['Installed by 1 other space']
export let reputed = (r: Reputation): string[] => [
  ...r.featured ? ['Featured by yaks.app'] : [],
  ...r.reviewed
    ? [
      `Reviewed by yaks.app on ${r.reviewed.at.slice(0, 10)}${
        r.reviewed.version != null ? `, version ${r.reviewed.version}` : ''
      }`,
    ]
    : [],
  installedBy(r.installs),
]

/** What yaks.app says of something shared, as a card or a page shows it:
 * any phrases of the caller's own, then each of {@link reputed}. */
export let reputationOf = (r: Reputation, first: string[] = []) =>
  h(
    'ul',
    { class: 'Reputation', 'aria-label': 'What yaks.app says of it' },
    [...first, ...reputed(r)].map((said, i) =>
      h(
        'li',
        {
          class: i == first.length && r.featured
            ? 'Reputation_Item Reputation_Item-featured'
            : 'Reputation_Item',
        },
        said,
      )
    ),
  )

export type Standing = 'listed' | 'asked' | 'no'

export let standing = (shared: Pick<Shared, 'gallery'>): Standing =>
  shared.gallery?.listedAt ? 'listed' : shared.gallery?.askedAt ? 'asked' : 'no'

// The word the space page's pill wears, which is the same three states said
// short enough to sit beside an app's name.
export let pilled = (at: Standing) =>
  at == 'listed' ? 'in the gallery' : at == 'asked' ? 'gallery: waiting' : ''
