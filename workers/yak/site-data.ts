// Whose a hostname's browser storage is (T-131927). A space's name can come to
// serve another space (a rename onto a name another space left, or that name
// claimed, D-131924), and a custom domain can be aimed at another space; the
// origin stays, and with it the local storage, IndexedDB, caches and service
// workers the previous space's apps left in each visitor's browser. So every
// page of a space tells its browser, in a cookie of the hostname's own, which
// space it saw there last, and a page of another space is sent
// `Clear-Site-Data: "storage"` once: the new space starts with an empty origin.
//
// Never `"cookies"` (Jeff, T-149225): the session lives on the apex, and a
// cookie cleared here would reach the registrable domain and sign everyone
// out. Cookies an app sets itself outlive the change, which is why the guide
// has apps keep local data in local storage (public/docs/storage.md).
// Imported by yak-front (kept-page.ts), so it reaches nothing else.
import { cookieValue } from '@yaks/platform/cookie'

/** The cookie naming the space whose page this hostname last served the
 * browser: its handle (directory.ts `Space.store`), which no rename moves. */
export let SPACE = 'yak_space'

// As long as a browser keeps any cookie (Chrome's cap is 400 days).
let KEEPS = 400 * 24 * 60 * 60

/** The page `res` answering `req` as a page of the space `handle`: as it
 * was where the browser saw that space here last, else telling it so, and
 * clearing the origin's storage where it saw another. Anything but an HTML
 * page, which is where an app's scripts start, is left alone. */
export let claimed = (req: Request, res: Response, handle: string) => {
  let page = (res.status == 200 || res.status == 304) &&
    (res.headers.get('content-type') ?? '').startsWith('text/html')
  let held = cookieValue(req.headers.get('cookie'), SPACE)
  if (!page || held == handle) return res
  let out = new Response(res.body, res)
  if (held) out.headers.set('clear-site-data', '"storage"')
  out.headers.append(
    'set-cookie',
    `${SPACE}=${handle}; Path=/; Max-Age=${KEEPS}; Secure; HttpOnly; SameSite=Lax`,
  )
  return out
}

// The space each request was answered a page of, by the request the browser
// sent (apps.ts `served`, then `fetch`), so the answer is told it on its way
// out whichever of the space's doors made it.
let serving = new WeakMap<Request, string>()

/** That `req` is answered by the space `handle`. */
export let serves = (req: Request, handle: string) =>
  void serving.set(req, handle)

/** `res` claimed for the space `req` was answered by, if it was one. */
export let stamped = (req: Request, res: Response) => {
  let handle = serving.get(req)
  return handle ? claimed(req, res, handle) : res
}
