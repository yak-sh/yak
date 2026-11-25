// The platform's own script in every page an app serves: the reporter
// (public/report.js), the release listener (public/release.js), the framed
// address reporter (public/location.js), the badge (public/badge.js) in a page
// of a space on the free plan, the corner (public/edit.js), its note to the
// Operator and its pencil, in a page served to a member who may write the
// app, and the visitor's bar (public/visit.js) in a
// page served to a stranger from a published app's sample or their own store of
// it (@yaks/platform/visits), woven into the page's text inline, as
// @yaks/platform/woven `tagged` weaves them.
//
// Beside the mount and release every tag says, the release listener's and
// the pencil's also say where the app's own `api/` is when it is not under
// the mount (`data-yak-api`). The badge's says what it opens
// (`data-yak-badge`): the app's own page on yaks.app, or yaks.app itself; on
// a paid space whose owner chose it, it is the line "Website by yaks.app" at
// the page's foot (`data-yak-byline`), opening yaks.app's organizations page. The
// corner's says where the Operator's chat for the app is (`data-yak-edit`)
// and where its note is (`data-yak-note`), a page of yaks.app's own.
// The bar's says where keeping it goes and what its button says
// (`data-yak-keep`, `data-yak-keep-says`).
//
// A page with a Content-Security-Policy of its own is given the scripts'
// hashes (@yaks/platform/woven `admitted`).
import { caught } from './defects.ts'
import type { Bar } from '@yaks/platform/visits'
import { sharing } from './lib/shared.ts'
import { inline, type Script, tagged } from '@yaks/platform/woven'
import { OPEN_PATH } from '@yaks/timing/interaction'
import { openScript } from '@yaks/platform/open-script'

type Assets = { fetch: (req: Request) => Promise<Response> }

let FILES = [
  '/report.js',
  '/release.js',
  '/badge.js',
  '/visit.js',
  '/location.js',
  '/edit.js',
  '/_install.js',
]

/** The platform's scripts a page wears beyond the reporter and the release
 * listener: the badge, opening `badge` unless it is null; a draft's preview
 * link it follows, which wears the release and address listeners; the pencil,
 * offering the Operator's chat at `edit`; the visitor's bar. */
export type Scripts = {
  badge: string | null
  /** The host of the site a preview was rebuilt from, which its badge says
   * this page is not (newcomer.ts `previewing`). */
  preview?: string | null
  /** The badge drawn as a paid space's line at the page's foot, "Website by
   * yaks.app" (@yaks/platform/woven `bylineOf`). */
  byline?: boolean
  draft?: string
  edit?: string | null
  /** The corner's note, yaks.app's own page (apps.ts `cornerOf`). */
  note?: string | null
  /** Where the app's own `api/` is for this browser, where it is not under
   * the mount (@yaks/platform/routes `API_AT`): the release listener's and
   * the pencil's doors. */
  api?: string | null
  bar?: Bar | null
}

let read = (assets: Assets) =>
  Promise.all(FILES.map(async (path): Promise<Script> => {
    let res = await assets.fetch(new Request(`https://assets.invalid${path}`))
    if (!res.ok) throw new Error(`page script ${path}: ${res.status}`)
    let source = await res.text()
    return await inline(
      path == '/report.js' ? `${source}\n;${openScript()}` : source,
    )
  }))

// Read once per isolate: the files are the deploy's own and never change
// under it. A failed read is not kept, so the next page asks again.
let held = new WeakMap<Assets, Promise<Script[]>>()
let scripts = (assets: Assets) => sharing(held, assets, () => read(assets))

/** The tags for a page mounted at `at`, of release `version`, wearing
 * `worn`, and the hashes a policy needs to admit them. A page of a draft's
 * preview link (preview.ts) carries the release and address listeners, told the
 * `draft` it follows (`data-yak-draft`). A page whose scripts could not be
 * read is served without them, and the failure is reported: a page that
 * paints without its reporter beats one that fails. */
export let pageScript = async (
  assets: Assets,
  at: string,
  version: number,
  { badge, draft, bar, preview, byline, edit, note, api }: Scripts,
) => {
  try {
    let [report, release, badged, barred, location, pencil, install] =
      await scripts(
        assets,
      )
    if (draft) {
      return tagged(at, version, [
        [location],
        [release, { 'data-yak-draft': draft }],
      ])
    }
    let doors: Record<string, string> = api ? { 'data-yak-api': api } : {}
    let worn: [Script, Record<string, string>][] = [
      [report, {
        'data-yak-open': api
          ? OPEN_PATH
          : `${at.replace(/\/$/, '')}/_web/assets/interaction?open=1`,
      }],
      [release, doors],
      [location, {}],
      [install, {}],
    ]
    if (badge != null) {
      worn.push([badged, {
        'data-yak-badge': badge,
        ...preview ? { 'data-yak-preview': preview } : {},
        ...byline ? { 'data-yak-byline': '' } : {},
      }])
    }
    if (edit) {
      worn.push([pencil, {
        'data-yak-edit': edit,
        ...note ? { 'data-yak-note': note } : {},
        ...doors,
      }])
    }
    if (bar) {
      worn.push([barred, {
        'data-yak-keep': bar.keep,
        'data-yak-keep-says': bar.says,
      }])
    }
    return tagged(at, version, worn)
  } catch (e) {
    caught(e, { request: 'page script' })
    return { tags: '', hashes: [] }
  }
}
