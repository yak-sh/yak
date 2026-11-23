// An app attached to another app's store (store_attach, D-469): a `uses` link
// in the directory from the app to the other app, the link connection_attach
// writes from an app to a connection. Its binding is the name the app's code
// reads the store's address by, from ./api/env, and passes to `store(base)`.
//
// The link is the whole grant. An app out of the sandbox already reaches
// every sibling as the person using it, so to it the link says only which
// store. A sandboxed app reaches nothing but its own store, until its page
// token opens a store it is attached to as well: that store's `/api/`, as the
// person who loaded the page, with their own role there (page-token.ts
// `paged`, apps.ts). The link is read on every such request, so an app
// detached is refused at its next one.
//
// What serves a request is here; the tool that writes the link is
// attach-tools.ts, so a page that only serves a space never compiles the
// tools' words (T-148886).
import { line } from '@yaks/query'
import { edgeEid } from '@yaks/edge'
import { USES } from '@yaks/connections/identity'
import type { Bundle, Comp } from '@yaks/graph'
import { type App, directoryOf, type Space } from './directory.ts'
import type { Env } from './env.ts'
import { meta } from './meta.ts'
import type { Reaches } from './page-token.ts'

/** The name an app reads a store by when its attach names none: the store's
 * slug in capitals. */
/// bindingOf('crayon-bloom') -> 'CRAYON_BLOOM'
export let bindingOf = (slug: string) =>
  slug.toUpperCase().replace(/[^A-Z0-9_]/g, '_').replace(/^(?=\d)/, '_')

/** The address `store(base)` takes for an app's store. */
/// addressOf('shop') -> '/shop/api/'
export let addressOf = (slug: string) => `/${slug}/api/`

// The doors of a store an attached app's page token opens: its rows, their
// files, its socket, its words, who is asking, its commands and its sales.
// Never the store's own connections, code, storage or the platform services
// it spends from: those are other resources than its data.
let DOORS =
  /^\/api\/(query|apply|search|ws|blob|vocab\.json|who|commands?|pay)(\/|$)/

/** Whether an attached app's page token opens this path of a store. */
/// opens('/api/query') -> true
/// opens('/api/blob/abc') -> true
/// opens('/api/env') -> false
/// opens('/api/fetch') -> false
/// opens('/') -> false
export let opens = (path: string) => DOORS.test(path)

export let comp = (b: Bundle | undefined, name: string): Comp =>
  (b?.[name] ?? {}) as Comp

/** The link that attaches `from` to `to`'s store, if there is one. */
export let held = (env: Env, from: string, to: string) =>
  meta(env).query(line`.entity.eid=${edgeEid(from, USES, to)}&.${USES}&*`)

/** Whether an app is attached to `store`'s app: what a page token sealed for
 * another app asks before it opens this one. */
export let reaching = (env: Env, store: App): Reaches => async (app) =>
  app != store.eid && (await held(env, app, store.eid)).length > 0

/** The address of each store `app` is attached to, by its binding: what
 * ./api/env adds to the app's connections' sentinels. */
export let storesOf = async (
  env: Env,
  space: Space,
  app: App,
): Promise<Record<string, string>> => {
  let links = await meta(env).query(line`.edge.from=${app.eid}&.${USES}&*`)
  if (!links.length) return {}
  let apps = new Map(
    (await directoryOf(env.STORE).apps(space)).map((a) => [a.eid, a]),
  )
  let out: Record<string, string> = {}
  for (let l of links) {
    let to = apps.get(String(comp(l, 'edge').to))
    let binding = comp(l, USES).binding
    if (to && typeof binding == 'string') out[binding] = addressOf(to.slug)
  }
  return out
}
