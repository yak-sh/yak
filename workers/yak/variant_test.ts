// Which home page a visitor is shown (variant.ts): at `/` one drawn by the
// shares, at a page's own address that page, kept in its cookie, and named by
// every step that visitor's requests count.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { COOKIE, keep, shown, type Variant, variant } from './variant.ts'

let ALL: Variant[] = [
  { name: 'ask', path: '/', share: 1 },
  { name: 'describe', path: '/build', share: 1 },
  { name: 'church', path: '/churches', share: 0 },
]

let BROWSER = 'Mozilla/5.0 (Macintosh) AppleWebKit Safari'
let visit = (cookie?: string, path = '/', ua = BROWSER) =>
  new Request(`https://yaks.app${path}`, {
    headers: {
      'user-agent': ua,
      ...cookie ? { cookie: `yak_came=x; ${cookie}` } : {},
    },
  })
let kept = (req: Request, status = 200) =>
  keep(req, new Response('<html>', { status })).headers.get('set-cookie')

test('a first visit to the home page is drawn a variant by the shares, and keeps it', () => {
  let req = visit()
  assertEquals(shown(req, ALL, () => 0.7)?.name, 'describe')
  // Decided once: the page, the step and the cookie all say the same.
  assertEquals(shown(req, ALL, () => 0.1)?.name, 'describe')
  assertEquals(variant(req, ALL), 'describe')
  assertEquals(kept(req)?.startsWith(`${COOKIE}=describe;`), true)
  let failed = visit()
  shown(failed, ALL, () => 0.1)
  assertEquals(kept(failed, 500), null)
})

test('a visitor holding a variant the home page draws is shown it, and keeps no new cookie', () => {
  let req = visit(`${COOKIE}=describe`)
  assertEquals(shown(req, ALL, () => 0)?.name, 'describe')
  assertEquals(kept(req), null)
  // A variant no longer listed is drawn again.
  assertEquals(shown(visit(`${COOKIE}=gone`), ALL, () => 0)?.name, 'ask')
})

test("a landing page is shown at its own address only, and its visitor's steps count under it", () => {
  let req = visit(undefined, '/churches')
  assertEquals(shown(req, ALL, () => 0)?.name, 'church')
  assertEquals(variant(req, ALL), 'church')
  assertEquals(kept(req)?.startsWith(`${COOKIE}=church;`), true)
  // The sign-up that follows names it, on a request that shows no home page.
  let later = visit(`${COOKIE}=church`, '/login')
  assertEquals(shown(later, ALL), undefined)
  assertEquals(variant(later, ALL), 'church')
  assertEquals(kept(later), null)
  // The home page draws nobody a page with no share, its holder included, and
  // they hold what they are shown from then on.
  let home = visit(`${COOKIE}=church`)
  assertEquals(shown(home, ALL, () => 0)?.name, 'ask')
  assertEquals(kept(home)?.startsWith(`${COOKIE}=ask;`), true)
})

test('a crawler at the home page is shown its first page, whatever the draw, and keeps nothing', () => {
  let req = visit(undefined, '/', 'Googlebot/2.1')
  assertEquals(shown(req, ALL, () => 0.7)?.name, 'ask')
  assertEquals(kept(req), null)
})

test('a step names the variant its visitor holds, or none', () => {
  assertEquals(variant(visit(`${COOKIE}=describe`, '/login'), ALL), 'describe')
  assertEquals(variant(visit(undefined, '/login'), ALL), '')
  assertEquals(variant(visit(`${COOKIE}=gone`, '/login'), ALL), '')
})
