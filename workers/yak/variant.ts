// Which home page a visitor to yaks.app is shown, and which one every step
// they take counts under (funnel.ts). A home page is data: a name, the page
// Site keeps it at, and its share of the visitors `/` draws. A page with a
// share is one `/` shows, and several with one are a split of `/`, each drawn
// by its share. A page with none is a landing page: only its own address
// shows it, which is where an ad for one audience points.
//
// A visit to `/` shows the page its visitor holds, when that page has a
// share, else one drawn by the shares; a visit to a page's own address shows
// that page. Whichever is shown is kept in a cookie of its own on the apex,
// beside the arrival's (arrival.ts), so the click, the build and the sign-up
// that follow count under the page the visitor last saw. A crawler is drawn
// nothing and keeps nothing: `/` answers it with the first page that has a
// share, so an engine indexes one home page. Nothing here imports past
// @yaks/platform/cookie and crawlers.ts, so yak-front (front/) holds it.
import { isPerson } from './crawlers.ts'
import { cookieValue } from '@yaks/platform/cookie'

/** The cookie a visitor's variant is kept in. */
export let COOKIE = 'yak_home'

/** How long a variant is kept: as long as the arrival is (arrival.ts). */
export let DAYS = 90

/** One home page: its name in the funnel, where Site keeps it, and its share
 * of the visitors `/` draws. */
export type Variant = { name: string; path: string; share: number }

/** The page that pitches the Operator (site/operator.tsx). */
export let OPERATOR = '/operator'

/** The home pages: the one `/` shows, which leads with a working sign-up
 * sheet (site/home.tsx), and the landing pages. */
export let VARIANTS: Variant[] = [
  { name: 'demo', path: '/', share: 1 },
  { name: 'operator', path: OPERATOR, share: 0 },
  { name: 'church', path: '/churches', share: 0 },
  { name: 'organization', path: '/organizations', share: 0 },
]

/** The pages Site keeps for the home page (kept-page.ts `LISTINGS`). */
export let PATHS = [...new Set(VARIANTS.map((v) => v.path))]

let drawable = (all: Variant[]) => all.filter((v) => v.share > 0)

/**
 * The variant `roll` (a number in [0, 1)) lands on, by the shares.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let all = [
 *   { name: 'a', path: '/', share: 1 },
 *   { name: 'b', path: '/b', share: 3 },
 * ]
 * assertEquals(drawn(all, 0.2).name, 'a')
 * assertEquals(drawn(all, 0.3).name, 'b')
 * ```
 */
export let drawn = (all: Variant[], roll: number): Variant => {
  let open = drawable(all), total = open.reduce((n, v) => n + v.share, 0)
  let at = roll * total
  return open.find((v) => (at -= v.share) < 0) ?? open.at(-1) ?? all[0]
}

// What a request's visitor holds and is shown, decided once, so the page it
// answers, the step it counts and the cookie it keeps all say one variant.
let decided = new WeakMap<Request, { variant: Variant; fresh: boolean }>()

let held = (req: Request, all: Variant[]) => {
  let name = cookieValue(req.headers.get('cookie'), COOKIE)
  return all.find((v) => v.name == name)
}

/**
 * The home page this request is shown, or none when it asks for no home
 * page: at `/`, the one its visitor holds if `/` still draws it, else one
 * drawn, and for a crawler the first; at a page's own address, that page.
 */
export let shown = (
  req: Request,
  all = VARIANTS,
  roll = Math.random,
): Variant | undefined => {
  let was = decided.get(req)
  if (was) return was.variant
  let path = new URL(req.url).pathname, kept = held(req, all)
  let person = isPerson(req)
  let variant = path != '/'
    ? all.find((v) => v.path == path)
    : kept && kept.share > 0
    ? kept
    : drawn(all, person ? roll() : 0)
  if (variant) decided.set(req, { variant, fresh: person && variant != kept })
  return variant
}

/**
 * The home page a step of this request counts under (funnel.ts): the one it
 * was shown, else the one its visitor holds, else '' for a visitor who never
 * saw one.
 */
export let variant = (req: Request, all = VARIANTS): string =>
  (decided.get(req)?.variant ?? held(req, all))?.name ?? ''

/**
 * The answer to a home page, keeping the one shown where its visitor held
 * another or none; any other answer as it was. Apex only: no app's host ever
 * sees it.
 */
export let keep = (req: Request, res: Response): Response => {
  let was = decided.get(req)
  if (res.status >= 400 || !was?.fresh) return res
  let out = new Response(res.body, res)
  out.headers.append(
    'set-cookie',
    `${COOKIE}=${was.variant.name}; Max-Age=${DAYS * 86400}; Path=/; ` +
      'Secure; HttpOnly; SameSite=Lax',
  )
  return out
}
