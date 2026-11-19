// The sign-in link (link.ts): what a pass is worth and how it ends. A letter's
// one click dies with the code it carries, a standing link lives to its expiry
// unless somebody takes it back, and neither survives a foreign secret. Nothing
// here imports a Cloudflare name, so the whole contract holds in plain Deno;
// the door it hangs on is held through the kernel (identity_test.ts).
import { test } from '@yaks/testing'
import { kv } from './testing.ts'
import { kernel } from './probe.ts'
import { assert, assertEquals, assertRejects } from '@std/assert'
import { seal } from './lib/token.ts'
import {
  DAYS,
  links,
  MOST,
  onceLink,
  passOf,
  revoke,
  stand,
  whose,
} from './link.ts'
import { held } from './signin-fixture.ts'
import { mac, mint, spend } from './signin.ts'

let SECRET = 'a probe secret'
let ELSE = 'somebody else’s secret'
let ME = 'me@yaks.app'

// Import and derive both keys once; each link still signs and verifies its
// own payload in the test, including verification under the foreign key.
await seal('link', {}, SECRET)
await seal('link', {}, ELSE)

let k = await kernel()
let [P1, P2] = [crypto.randomUUID(), crypto.randomUUID()]
await k.dir.stamp({
  entities: [P1, P2].map((eid) => ({ entity: { eid }, person: {} })),
})

let book = () => links(kv(), k.dir)!

test('a letter’s link carries the code, and what it was finishing', async () => {
  let url = await onceLink(SECRET, {
    email: ME,
    code: '123456',
    q: 'a=b',
    back: 'https://yaks.app/manage/billing?space=jeff',
  })
  let t = new URL(url).searchParams.get('t')!
  let pass = await passOf(t, SECRET)
  assertEquals(pass?.once?.email, ME)
  assertEquals(pass?.once?.code, '123456')
  // The authorize request in flight rides in the seal, so a leaked link cannot
  // be re-aimed at a stranger's page.
  assertEquals(pass?.once?.q, 'a=b')
  assertEquals(pass?.once?.back, 'https://yaks.app/manage/billing?space=jeff')
  assert(!url.includes('a=b'))
  assertEquals(await passOf(t, ELSE), null)
})

test('following the link spends the code, and nothing spends it twice', async () => {
  let { at } = await held([])
  let code = (await mint(at, SECRET, ME))!
  let t = new URL(await onceLink(SECRET, { email: ME, code })).searchParams
    .get('t')!
  let pass = await passOf(t, SECRET)
  assert(await spend(at, SECRET, pass!.once!.email, pass!.once!.code))
  // The same link again, and the code it was said as: both dead.
  assertEquals(await spend(at, SECRET, ME, code), null)
})

test('a standing link lives to its expiry, and not past it', async () => {
  let now = Date.now()
  let { standing, url } = await stand(SECRET, book(), { person: P1 }, now)
  assertEquals(standing.exp, Math.floor(now / 1000) + DAYS * 86_400)
  assert(url.startsWith('https://yaks.app/login/link?t='))
  assertEquals(
    (await passOf(new URL(url).searchParams.get('t')!, SECRET))?.standing?.id,
    standing.id,
  )
})

test('a standing link needs its row: revoked, expired, or somebody else’s', async () => {
  let shelf = book()
  let now = Date.now()
  let { standing } = await stand(SECRET, shelf, { person: P1, days: 2 }, now)
  assertEquals(await whose(standing, shelf, now), P1)
  // Past its own expiry it opens nothing, row or no row.
  assertEquals(await whose(standing, shelf, now + 3 * 86_400_000), null)
  // A pass naming another person finds no row at all: the person is in the key.
  assertEquals(await whose({ ...standing, person: P2 }, shelf, now), null)
  // Nowhere to write one down is nowhere to take it back from.
  assertEquals(await whose(standing, null, now), null)
  // Revoked by the front of its id, and dead the moment the row goes.
  assertEquals(await revoke(shelf, P1, standing.id.slice(0, 4)), [
    standing.id,
  ])
  assertEquals(await whose(standing, shelf, now), null)
  assertEquals(await revoke(shelf, P1, 'nothing'), [])
})

test('a life outside the ceiling is refused, never clamped', async () => {
  let shelf = book()
  for (let days of [0, -1, MOST + 1]) {
    await assertRejects(() => stand(SECRET, shelf, { person: P1, days }))
  }
  assert((await stand(SECRET, shelf, { person: P1, days: MOST })).standing)
})

test('nothing but a well-formed pass under this secret opens', async () => {
  assertEquals(await passOf('', SECRET), null)
  assertEquals(await passOf('not a token', SECRET), null)
  // Sealed by us, and still not a pass: neither half is whole.
  for (
    let junk of [
      {},
      { once: { email: ME } },
      { standing: { id: 'a', person: 'p1' } },
    ]
  ) assertEquals(await passOf(await seal('link', junk, SECRET), SECRET), null)
  // And a store row is not a link: what it keeps is a mac, never the digits.
  assert((await mac(ME, '123456', SECRET)) != '123456')
  assertEquals(links(kv(), undefined), null)
})
