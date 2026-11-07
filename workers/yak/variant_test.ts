// Which home page a visitor is shown (variant.ts): drawn once by the shares,
// kept in its cookie, and named by every step that visitor's requests count.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { COOKIE, keep, shown, type Variant, variant } from './variant.ts'

let SPLIT: Variant[] = [
  { name: 'ask', path: '/', share: 1 },
  { name: 'operator', path: '/operator', share: 1 },
]
let ALONE: Variant[] = [{ name: 'ask', path: '/', share: 1 }]

let visit = (cookie?: string) =>
  new Request('https://yaks.app/', {
    headers: cookie ? { cookie: `yak_came=x; ${cookie}` } : {},
  })
let kept = (req: Request, status = 200) =>
  keep(req, new Response('<html>', { status })).headers.get('set-cookie')

test('a first visit to a split home page is drawn a variant by the shares, and keeps it', () => {
  let req = visit()
  assertEquals(shown(req, SPLIT, () => 0.7).name, 'operator')
  // Decided once: the page, the step and the cookie all say the same.
  assertEquals(shown(req, SPLIT, () => 0.1).name, 'operator')
  assertEquals(variant(req, SPLIT), 'operator')
  assertEquals(kept(req)?.startsWith(`${COOKIE}=operator;`), true)
  let failed = visit()
  shown(failed, SPLIT, () => 0.1)
  assertEquals(kept(failed, 500), null)
})

test('a visitor holding a variant is shown it, and keeps no new cookie', () => {
  let req = visit(`${COOKIE}=operator`)
  assertEquals(shown(req, SPLIT, () => 0).name, 'operator')
  assertEquals(kept(req), null)
  // A share of 0 draws nobody new, but its holders keep it.
  let closed = [SPLIT[0], { ...SPLIT[1], share: 0 }, { ...SPLIT[1], name: 'c' }]
  assertEquals(shown(visit(`${COOKIE}=operator`), closed).name, 'operator')
  // A variant no longer listed is drawn again.
  assertEquals(shown(visit(`${COOKIE}=gone`), SPLIT, () => 0).name, 'ask')
})

test('a step names the variant its visitor holds, or none', () => {
  assertEquals(variant(visit(`${COOKIE}=operator`), SPLIT), 'operator')
  assertEquals(variant(visit(), SPLIT), '')
  assertEquals(variant(visit(`${COOKIE}=gone`), SPLIT), '')
})

test('a home page with one variant shows it, keeps nothing and counts no variant', () => {
  let req = visit(`${COOKIE}=operator`)
  assertEquals(shown(req, ALONE).path, '/')
  assertEquals(variant(req, ALONE), '')
  assertEquals(kept(req), null)
})
