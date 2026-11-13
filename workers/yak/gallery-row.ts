// Where an app stands in the gallery, read off its row, and where its own page
// is: what a space's page shows of the gallery, apart from gallery.ts so a page
// that only serves a space never compiles the gallery's pages and letters
// (T-148886).
import type { Shared } from './directory.ts'
import { type Host, url as siteUrl } from '@yaks/platform/host'

// Where each published app's own page lives (app-page.ts): one address per
// platform-wide name, listed or not.
export let PAGE = '/apps/'
export let pageAt = (name: string, env: Host = {}) =>
  siteUrl(env, `${PAGE}${encodeURIComponent(name)}`)

/** How many other spaces installed a copy of something shared, said as a
 * line: what its maker is credited with (T-131912). */
export let installedBy = (n: number) =>
  `Installed by ${n} other ${n == 1 ? 'space' : 'spaces'}`

export type Standing = 'listed' | 'asked' | 'no'

export let standing = (shared: Pick<Shared, 'gallery'>): Standing =>
  shared.gallery?.listedAt ? 'listed' : shared.gallery?.askedAt ? 'asked' : 'no'

// The word the space page's pill wears, which is the same three states said
// short enough to sit beside an app's name.
export let pilled = (at: Standing) =>
  at == 'listed' ? 'in the gallery' : at == 'asked' ? 'gallery: waiting' : ''
