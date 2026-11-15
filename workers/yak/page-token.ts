// A sandboxed app's page token (D-37901, @yaks/platform/installs): the cookie
// authenticates the page load and nothing after it, so the page is handed a
// token sealed for this app's store and this person, which every relative URL
// it asks carries (installs.ts `tokenOf`). The router takes the cookie off any
// such request (index.ts), since the credential is in the URL and never one
// the browser attaches.
//
// The token names no session, because there is no session store: it lives
// as long as the cookie that loaded the page, and sign-out cannot end it
// early. The role it carries is never a claim — it is read live, on every
// call, like the cookie's.
import { opened, seal } from './lib/token.ts'
import { instrumentEid } from '@yaks/platform/instrument'
import { sha256 } from '@yaks/graph/sha256'
import { SESSION } from './session.ts'

type Page = { person: string | null; store: string; exp: number; via?: string }

let DAY = 24 * 60 * 60

/** When a page token dies: with the cookie that loaded the page, or, for a
 * visitor who is not signed in, a session's length from the end of today —
 * rounded, so the page's bytes (and their ETag) hold still through the day. */
export let lasting = (until: number | undefined, now = Date.now()) =>
  until ?? Math.ceil(now / 1000 / DAY) * DAY + SESSION

/** A page token: this person (or nobody) on this one store, until `exp`. */
export let paging = (
  secret: string,
  store: string,
  person: string | null,
  exp: number,
  via?: string,
) =>
  seal(
    'page',
    {
      person,
      store,
      exp,
      ...(via ? { via } : {}),
    } satisfies Page,
    secret,
  )

/** Who a page token says is asking, or null for anything but a live token
 * sealed for this store. Another app's token fails here, whoever holds it. */
export let paged = async (
  sealed: string,
  secret: string,
  store: string,
  now = Date.now(),
) => {
  let p = await opened<Page>('page', sealed, secret)
  if (!p || p.store != store || typeof p.exp != 'number') return null
  if (p.exp * 1000 <= now) return null
  return {
    person: typeof p.person == 'string' ? p.person : null,
    exp: p.exp,
    via: instrumentEid(
      typeof p.via == 'string' && p.via ? p.via : `page:${sha256(sealed)}`,
    ),
  }
}
