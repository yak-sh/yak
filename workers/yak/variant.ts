// Which home page a visitor to yaks.app is shown, when the home page is split
// between variants to see which one brings more people in. A variant is data:
// a name, the page Site keeps it at, and its share of the visitors drawn. The
// first visit to `/` draws one by the shares and keeps it in a cookie of its
// own on the apex, beside the arrival's (arrival.ts), so a visitor keeps
// seeing the page they were first shown, and their sign-up later counts under
// it (funnel.ts).
//
// The home page is split only while two variants or more have a share. Until
// then `/` shows the one that has, no cookie is kept, and no step counts under
// a variant. A variant whose share is 0 is drawn by nobody new, but whoever
// holds it keeps it. Nothing here imports past @yaks/platform/cookie, so yak-front
// (front/) holds it.
import { cookieValue } from '@yaks/platform/cookie'

/** The cookie a visitor's variant is kept in. */
export let COOKIE = 'yak_home'

/** How long a variant is kept: as long as the arrival is (arrival.ts). */
export let DAYS = 90

/** One home page: its name in the funnel, where Site keeps it, and its share
 * of the visitors drawn. */
export type Variant = { name: string; path: string; share: number }

/** The page that pitches the Operator (site/operator.tsx). */
export let OPERATOR = '/operator'

/** The home pages `/` is split between. */
export let VARIANTS: Variant[] = [
  { name: 'ask', path: '/', share: 1 },
  { name: 'operator', path: OPERATOR, share: 0 },
]

/** The pages Site keeps for the home page (kept-page.ts `LISTINGS`). */
export let PATHS = [...new Set(VARIANTS.map((v) => v.path))]

let drawable = (all: Variant[]) => all.filter((v) => v.share > 0)

/** Whether the home page is split: two variants or more have a share. */
export let split = (all = VARIANTS) => drawable(all).length > 1

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
 * The home page this request is shown: the variant its visitor holds, else
 * one drawn for it.
 */
export let shown = (
  req: Request,
  all = VARIANTS,
  roll = Math.random,
): Variant => {
  let was = decided.get(req)?.variant
  if (was) return was
  if (!split(all)) return drawable(all)[0] ?? all[0]
  let kept = held(req, all), variant = kept ?? drawn(all, roll())
  decided.set(req, { variant, fresh: !kept })
  return variant
}

/**
 * The variant a step of this request counts under (funnel.ts): the one its
 * home page was shown, else the one its visitor holds, else '' while the home
 * page is not split or the visitor never saw it.
 */
export let variant = (req: Request, all = VARIANTS): string =>
  (decided.get(req)?.variant ??
    (split(all) ? held(req, all) : undefined))?.name ?? ''

/**
 * The answer to the home page, keeping the variant drawn for it; any other
 * answer as it was. Apex only: no app's host ever sees it.
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
