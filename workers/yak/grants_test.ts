// The CLI grant (grants.ts): what a token is worth and how it ends. Minting,
// verifying, the ceiling on how long one may live, death by expiry and death
// by revocation — and the narrowing, which is a wrapper over the directory
// every tool reads membership out of. Nothing here imports a Cloudflare name,
// so the whole contract holds in plain Deno; the door it hangs on is held in
// the kernel (mcp_test.ts).
import { test } from '@yaks/testing'
import { kv } from './testing.ts'
import { kernel } from './probe.ts'
import { assert, assertEquals, assertRejects } from '@std/assert'
import { seal } from './lib/token.ts'
import type { Directory, Space } from './directory.ts'
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
  tokenOf,
} from './grants.ts'

let SECRET = 'grant-test-secret'

let k = await kernel()
// Two people the directory holds: a grant's row names its person.
let [P1, P2] = [crypto.randomUUID(), crypto.randomUUID()]
await k.dir.stamp({
  entities: [P1, P2].map((eid) => ({ entity: { eid }, person: {} })),
})

// A view of one KV as a location that read it before keeps it: every read it
// once answered, answered again, which is how KV serves a key for a minute
// after it changed elsewhere.
let stale = (base: ReturnType<typeof kv>) => {
  let seen = new Map<string, unknown>()
  return {
    ...base,
    get: async (key: string) => {
      if (!seen.has(key)) seen.set(key, await base.get(key))
      return seen.get(key) as string | null
    },
  }
}

let book = () => ledger(kv(), k.dir) as Ledger

test('a grant is minted, and the token names it back', async () => {
  let b = book()
  let { grant, token } = await mint(SECRET, b, { person: P1 })
  assert(token.startsWith(GRANT), 'a grant says so in its first characters')
  assertEquals(grant.space, null)
  assertEquals(await held(token, SECRET, b), grant)
  // An hour by default, said in seconds.
  assertEquals(grant.exp - Math.floor(Date.now() / 1000) > 3500, true)
})

test('a grant carries the space it was narrowed to', async () => {
  let b = book()
  let { token } = await mint(SECRET, b, {
    person: P1,
    space: { eid: 'e-dana', slug: 'dana' },
  })
  assertEquals((await held(token, SECRET, b))?.space, 'dana')
  assertEquals((await held(token, SECRET, b))?.spaceEid, 'e-dana')
})

test('hours: asked for, and refused past the ceiling', async () => {
  let b = book()
  let now = Date.now()
  let { grant } = await mint(SECRET, b, { person: P1, hours: 6 }, now)
  assertEquals(grant.exp, Math.floor(now / 1000) + 6 * 3600)
  for (let hours of [0, -1, HOURS + 1, NaN]) {
    await assertRejects(
      () => mint(SECRET, b, { person: P1, hours }),
      Error,
      'hours:',
    )
  }
})

test('a held grant minted before stable space identities keeps working', async () => {
  let b = book()
  let grant: Grant = {
    id: 'older',
    person: P1,
    space: 'dana',
    exp: Math.floor(Date.now() / 1000) + 3600,
  }
  await b.keep(grant)
  assertEquals(await held(await tokenOf(grant, SECRET), SECRET, b), grant)
})

test('a grant is refused when it expires', async () => {
  let b = book()
  let now = Date.now()
  let { token } = await mint(SECRET, b, { person: P1, hours: 1 }, now)
  assert(await held(token, SECRET, b, now + 59 * 60_000))
  assertEquals(await held(token, SECRET, b, now + 61 * 60_000), null)
})

test('a grant is refused when it is revoked, by id or by prefix', async () => {
  let b = book()
  let one = await mint(SECRET, b, { person: P1 })
  let two = await mint(SECRET, b, { person: P1 })
  assertEquals(await revoke(b, P1, one.grant.id), [one.grant.id])
  assertEquals(await held(one.token, SECRET, b), null)
  // The other is untouched, and a prefix of its id names it.
  assert(await held(two.token, SECRET, b))
  assertEquals(await revoke(b, P1, two.grant.id.slice(0, 6)), [two.grant.id])
  assertEquals(await held(two.token, SECRET, b), null)
  // A prefix nobody wears revokes nothing, and says so by answering none.
  assertEquals(await revoke(b, P1, 'zzzz'), [])
})

test("one person's grant is not another's to revoke", async () => {
  let b = book()
  let { grant, token } = await mint(SECRET, b, { person: P1 })
  assertEquals(await revoke(b, P2, grant.id), [])
  assert(await held(token, SECRET, b))
})

test('revoking a CLI grant prefix leaves connector grants in place', async () => {
  let grant: Grant = {
    id: 'abcdef123456',
    person: P1,
    space: null,
    exp: Math.floor(Date.now() / 1000) + 3600,
  }
  let token = await tokenOf(grant, SECRET)
  let connector = JSON.stringify({
    id: 'abcdef-connector',
    userId: grant.person,
    clientId: 'connector',
    scope: ['mcp'],
    encryptedProps: 'sealed',
  })
  let key = `grant:${grant.person}:abcdef-connector`
  let store = kv()
  let b = ledger(store, k.dir)!
  await store.put(key, connector)
  await b.keep(grant)
  await b.wear('container', grant)
  let worn = (await b.wearing('container'))!
  assertEquals(await b.held(worn.person, worn.id), grant)
  assertEquals(await held(token, SECRET, b), grant)
  let gone = await revoke(b, grant.person, 'abcdef')
  assertEquals(await store.get(key), connector)
  assertEquals(gone, [grant.id])
  assertEquals(await held(token, SECRET, b), null)
  assertEquals(await revoke(b, grant.person, 'abcdef'), [])
  assertEquals(await b.held(grant.person, 'abcdef-connector'), null)
})

test('a forged, edited or foreign token is nobody', async () => {
  let b = book()
  let { grant, token } = await mint(SECRET, b, { person: P1 })
  // Another secret's seal, carrying a grant this ledger really holds.
  let forged = GRANT + await seal('grant', grant, 'other')
  assertEquals(await held(forged, SECRET, b), null)
  // Sealed under ours, but naming a grant nothing was ever written for: the
  // row is the revocation, so a token without one is not a caller.
  let unwritten: Grant = { ...grant, id: 'deadbeefdead' }
  assertEquals(
    await held(GRANT + await seal('grant', unwritten, SECRET), SECRET, b),
    null,
  )
  // An OAuth access token is the provider's to verify, never this door's.
  assertEquals(await held('p-1:g-1:secret', SECRET, b), null)
  // And with nowhere to write grants down, nothing verifies as one.
  assertEquals(await held(token, SECRET, null), null)
})

test('no ledger is no grants at all', () => {
  assertEquals(ledger(kv(), undefined), null)
  assertEquals(ledger(undefined, k.dir), null)
})

test('a revoked grant is refused at once where KV still answers it', async () => {
  let store = kv()
  let here = ledger(store, k.dir)!, there = ledger(stale(store), k.dir)!
  let { grant, token } = await mint(SECRET, here, { person: P1 })
  assert(await held(token, SECRET, there))
  await revoke(here, P1, grant.id)
  assertEquals(await held(token, SECRET, there), null)
  assertEquals(await there.stands(P1, grant.id), false)
})

test('a grant kept only in KV keeps working, and its row then decides', async () => {
  let store = kv(), P3 = crypto.randomUUID()
  await k.dir.stamp({ entities: [{ entity: { eid: P3 }, person: {} }] })
  let old: Grant = {
    id: 'kvonly123456',
    person: P3,
    space: 'dana',
    spaceEid: 'e-dana',
    exp: Math.floor(Date.now() / 1000) + 3600,
  }
  await store.put(`cli-grant:${P3}:${old.id}`, JSON.stringify(old))
  let b = ledger(stale(store), k.dir)!
  let token = await tokenOf(old, SECRET)
  assertEquals(await held(token, SECRET, b), old)
  assertEquals(await b.ids(P3), [old.id])
  assertEquals(await revoke(b, P3, old.id), [old.id])
  assertEquals(await held(token, SECRET, b), null)
  assertEquals(await b.ids(P3), [])
})

test('a grant stands only while its person does', async () => {
  let ghost = crypto.randomUUID()
  let b = book()
  let { grant } = await mint(SECRET, b, { person: ghost })
  assertEquals(await b.stands(ghost, grant.id), false)
})

// The narrowing, over a directory of two spaces the person owns.
let spaces = [
  { eid: 'e-dana', slug: 'dana' },
  { eid: 'e-other', slug: 'other' },
] as unknown as Space[]

let dir = {
  space: (slug: string) => Promise.resolve(spaces.find((s) => s.slug == slug)),
  spaces: () => Promise.resolve(spaces),
  role: () => Promise.resolve('owner'),
  own: () => Promise.resolve(spaces[1]),
} as unknown as Directory

test('a narrowed grant reaches one space and no other', async () => {
  let only = narrowed(dir, 'dana')
  assertEquals((await only.space('dana'))?.slug, 'dana')
  assertEquals(await only.space('other'), null)
  assertEquals((await only.spaces('p-1')).map((s) => s.slug), ['dana'])
  assertEquals(await only.role(spaces[0], 'p-1'), 'owner')
  assertEquals(await only.role(spaces[1], 'p-1'), null)
  // What a tool given no space asks for is the space the grant is for, not
  // whichever one the person would otherwise mean.
  assertEquals((await only.own('p-1')).slug, 'dana')
  await assertRejects(
    () => narrowed(dir, 'gone').own('p-1'),
    Error,
    'no space gone',
  )
  let moved = { ...spaces[0], slug: 'renamed' }
  let replacement = { ...spaces[1], slug: 'dana' }
  let current = [moved, replacement]
  let changed = {
    ...dir,
    space: (slug: string) =>
      Promise.resolve(current.find((s) => s.slug == slug) ?? null),
    at: (eid: string) =>
      Promise.resolve(current.find((s) => s.eid == eid) ?? null),
    spaces: () => Promise.resolve(current),
  } as Directory
  let stable = narrowed(changed, 'dana', moved.eid)
  assertEquals(await stable.space('dana'), null)
  assertEquals(await stable.space('renamed'), moved)
  assertEquals(await stable.role(replacement, 'p-1'), null)
  assertEquals(await stable.role(moved, 'p-1'), 'owner')
  assertEquals(await stable.spaces('p-1'), [moved])
  assertEquals(await stable.own('p-1'), moved)
})
