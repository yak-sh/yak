// The CLI grant (grants.ts): what a token is worth and how it ends. Minting,
// verifying, the ceiling on how long one may live, death by expiry and death
// by revocation — and the narrowing, which is a wrapper over the directory
// every tool reads membership out of. Nothing here imports a Cloudflare name,
// so the whole contract holds in plain Deno; the door it hangs on is held in
// workerd (mcp_test.ts).
import { assert, assertEquals, assertRejects } from '@std/assert'
import { seal } from '../../src/token.ts'
import type { Directory } from './directory.ts'
import {
  GRANT,
  type Grant,
  held,
  HOURS,
  type Ledger,
  ledger,
  mint,
  narrowed,
  revoke,
} from './grants.ts'

let SECRET = 'grant-test-secret'

// A Map-backed KV standing in for OAUTH_KV, with the one shape grants.ts asks
// for. TTL is not simulated: expiry is the token's own `exp`, which the tests
// below move by handing `now` in.
let kv = () => {
  let m = new Map<string, string>()
  return {
    get: (k: string) => Promise.resolve(m.get(k) ?? null),
    put: (k: string, v: string) => (m.set(k, v), Promise.resolve()),
    delete: (k: string) => (m.delete(k), Promise.resolve()),
    list: ({ prefix }: { prefix: string }) =>
      Promise.resolve({
        keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({
          name,
        })),
      }),
  }
}

let book = () => ledger(kv()) as Ledger

Deno.test('a grant is minted, and the token names it back', async () => {
  let b = book()
  let { grant, token } = await mint(SECRET, b, { person: 'p-1' })
  assert(token.startsWith(GRANT), 'a grant says so in its first characters')
  assertEquals(grant.space, null)
  assertEquals(await held(token, SECRET, b), grant)
  // An hour by default, said in seconds.
  assertEquals(grant.exp - Math.floor(Date.now() / 1000) > 3500, true)
})

Deno.test('a grant carries the space it was narrowed to', async () => {
  let b = book()
  let { token } = await mint(SECRET, b, { person: 'p-1', space: 'dana' })
  assertEquals((await held(token, SECRET, b))?.space, 'dana')
})

Deno.test('hours: asked for, and refused past the ceiling', async () => {
  let b = book()
  let now = Date.now()
  let { grant } = await mint(SECRET, b, { person: 'p-1', hours: 6 }, now)
  assertEquals(grant.exp, Math.floor(now / 1000) + 6 * 3600)
  for (let hours of [0, -1, HOURS + 1, NaN]) {
    await assertRejects(
      () => mint(SECRET, b, { person: 'p-1', hours }),
      Error,
      'hours:',
    )
  }
})

Deno.test('a grant is refused when it expires', async () => {
  let b = book()
  let now = Date.now()
  let { token } = await mint(SECRET, b, { person: 'p-1', hours: 1 }, now)
  assert(await held(token, SECRET, b, now + 59 * 60_000))
  assertEquals(await held(token, SECRET, b, now + 61 * 60_000), null)
})

Deno.test('a grant is refused when it is revoked, by id or by prefix', async () => {
  let b = book()
  let one = await mint(SECRET, b, { person: 'p-1' })
  let two = await mint(SECRET, b, { person: 'p-1' })
  assertEquals(await revoke(b, 'p-1', one.grant.id), [one.grant.id])
  assertEquals(await held(one.token, SECRET, b), null)
  // The other is untouched, and a prefix of its id names it.
  assert(await held(two.token, SECRET, b))
  assertEquals(await revoke(b, 'p-1', two.grant.id.slice(0, 6)), [two.grant.id])
  assertEquals(await held(two.token, SECRET, b), null)
  // A prefix nobody wears revokes nothing, and says so by answering none.
  assertEquals(await revoke(b, 'p-1', 'zzzz'), [])
})

Deno.test("one person's grant is not another's to revoke", async () => {
  let b = book()
  let { grant, token } = await mint(SECRET, b, { person: 'p-1' })
  assertEquals(await revoke(b, 'p-2', grant.id), [])
  assert(await held(token, SECRET, b))
})

Deno.test('a forged, edited or foreign token is nobody', async () => {
  let b = book()
  let { grant, token } = await mint(SECRET, b, { person: 'p-1' })
  // Another secret's seal, carrying a grant this ledger really holds.
  let forged = GRANT + await seal(grant, 'other')
  assertEquals(await held(forged, SECRET, b), null)
  // Sealed under ours, but naming a grant nothing was ever written for: the
  // row is the revocation, so a token without one is not a caller.
  let unwritten: Grant = { ...grant, id: 'deadbeefdead' }
  assertEquals(
    await held(GRANT + await seal(unwritten, SECRET), SECRET, b),
    null,
  )
  // An OAuth access token is the provider's to verify, never this door's.
  assertEquals(await held('p-1:g-1:secret', SECRET, b), null)
  // And with nowhere to write grants down, nothing verifies as one.
  assertEquals(await held(token, SECRET, null), null)
})

Deno.test('no ledger is no grants at all', () => {
  assertEquals(ledger(undefined), null)
  assertEquals(ledger({}), null)
})

// The narrowing, over a directory of two spaces the person owns.
let spaces = [
  { eid: 'e-dana', slug: 'dana' },
  { eid: 'e-other', slug: 'other' },
] as unknown as Parameters<Directory['role']>[0][]

let dir = {
  space: (slug: string) => Promise.resolve(spaces.find((s) => s.slug == slug)),
  spaces: () => Promise.resolve(spaces),
  role: () => Promise.resolve('owner'),
  own: () => Promise.resolve(spaces[1]),
} as unknown as Directory

Deno.test('a narrowed grant reaches one space and no other', async () => {
  let only = narrowed(dir, 'dana')
  assertEquals((await only.space('dana'))?.slug, 'dana')
  assertEquals(await only.space('other'), null)
  assertEquals((await only.spaces('p-1')).map((s) => s.slug), ['dana'])
  assertEquals(await only.role(spaces[0], 'p-1'), 'owner')
  assertEquals(await only.role(spaces[1], 'p-1'), null)
  // What a tool given no space asks for is the space the grant is for, not
  // whichever one the person would otherwise mean.
  assertEquals((await only.own('p-1')).slug, 'dana')
})
