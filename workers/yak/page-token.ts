// A sandboxed app's page token (D-37901, @yaks/platform/installs): the cookie
// authenticates the page load and nothing after it, so the page is handed a
// token sealed for this app's store and this person, which every relative URL
// it asks carries (installs.ts `tokenOf`). The router takes the cookie off any
// such request (index.ts), since the credential is in the URL and never one
// the browser attaches.
//
// It shares the browser session's revocation and expiry. The role is read
// live on every call, like the cookie's.
import { opened, seal } from './lib/token.ts'
import { instrumentEid } from '@yaks/platform/instrument'
import { sha256 } from '@yaks/graph/sha256'
import { SESSION } from './session.ts'
import type { Env } from './env.ts'
import { held } from './browser-sessions.ts'

type Page = {
  person: string | null
  store: string
  app?: string
  exp: number
  via?: string
  session?: string
}

let DAY = 24 * 60 * 60

/** When a page token dies: with the cookie that loaded the page, or, for a
 * visitor who is not signed in, a session's length from the end of today —
 * rounded, so the page's bytes (and their ETag) hold still through the day. */
export let lasting = (until: number | undefined, now = Date.now()) =>
  until ?? Math.ceil(now / 1000 / DAY) * DAY + SESSION

/** A page token: this person (or nobody) on this one app's store, until
 * `exp`. */
export let paging = (
  secret: string,
  store: string,
  app: string,
  person: string | null,
  exp: number,
  via?: string,
  session?: string,
) =>
  seal(
    'page',
    {
      person,
      store,
      app,
      exp,
      ...(via ? { via } : {}),
      ...(session ? { session } : {}),
    } satisfies Page,
    secret,
  )

/** Whether the app a page token was sealed for is attached to this store
 * (store_attach), asked only of another app's token. */
export type Reaches = (app: string) => Promise<boolean>

/** Who a page token says is asking, or null for anything but a live token
 * sealed for this store, or for an app `reaches` says is attached to it.
 * Any other app's token fails here, whoever holds it. `attached` says the
 * token is another app's. */
export let paged = async (
  sealed: string,
  env: Env,
  store: string,
  reaches?: Reaches,
  now = Date.now(),
) => {
  if (!env.SESSION_SECRET) return null
  let p = await opened<Page>('page', sealed, env.SESSION_SECRET)
  if (!p || typeof p.exp != 'number') return null
  let attached = p.store != store
  if (
    attached &&
    !(typeof p.app == 'string' && reaches && await reaches(p.app))
  ) return null
  if (p.exp * 1000 <= now) return null
  if (
    p.person && !await held(
      env,
      p.person,
      p.via ?? `page:${sha256(sealed)}`,
      p.session,
    )
  ) return null
  return {
    person: typeof p.person == 'string' ? p.person : null,
    exp: p.exp,
    ...(attached ? { attached: true as const } : {}),
    ...(p.session ? { session: p.session } : {}),
    via: instrumentEid(
      typeof p.via == 'string' && p.via ? p.via : `page:${sha256(sealed)}`,
    ),
  }
}
