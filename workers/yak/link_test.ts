// The sign-in link (link.ts): what a pass is worth and how it ends. A letter's
// one click dies with the code it carries, a standing link lives to its expiry
// unless somebody takes it back, and neither survives a foreign secret. Nothing
// here imports a Cloudflare name, so the whole contract holds in plain Deno;
// the door it hangs on is held in workerd (identity_test.ts).
import { assert, assertEquals, assertRejects } from '@std/assert'
import type { Bundle } from '@yaks/graph'
import { seal } from '../../src/token.ts'
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
import type { Meta } from './meta.ts'
import { mac, mint, spend } from './signin.ts'

let SECRET = 'a probe secret'
let ELSE = 'somebody else’s secret'
let ME = 'me@yaks.app'

// The KV as `shelf` asks for it, in a map.
let kv = () => {
  let rows = new Map<string, string>()
  return {
    rows,
    get: (k: string) => Promise.resolve(rows.get(k) ?? null),
    put: (k: string, v: string) => (rows.set(k, v), Promise.resolve()),
    delete: (k: string) => (rows.delete(k), Promise.resolve()),
    list: ({ prefix }: { prefix: string }) =>
      Promise.resolve({
        keys: [...rows.keys()].filter((k) => k.startsWith(prefix)).map((
          name,
        ) => ({ name })),
      }),
  }
}

let book = () => links(kv())!

// The meta store signin.ts writes through, holding its rows: a mint adds one,
// a tombstone takes it away, and a `tries` patch lands on the row it names —
// enough that spending a code twice is the same story here as in the store.
let store = () => {
  let rows: Bundle[] = []
  let at: Meta = {
    query: () => Promise.resolve([...rows]),
    apply: (bundles) => {
      for (let b of bundles) {
        if (b.tombstone) {
          rows = rows.filter((r) => r.entity.eid != b.entity.eid)
          continue
        }
        let held = rows.find((r) => r.entity.eid == b.entity.eid)
        if (held) Object.assign(held.signin as object, b.signin)
        else rows.push({ ...b, entity: { eid: `e${rows.length + 1}` } })
      }
      return Promise.resolve(bundles)
    },
  }
  return at
}

Deno.test('a letter’s link carries the code, and what it was finishing', async () => {
  let url = await onceLink(SECRET, { email: ME, code: '123456', q: 'a=b' })
  let t = new URL(url).searchParams.get('t')!
  let pass = await passOf(t, SECRET)
  assertEquals(pass?.once?.email, ME)
  assertEquals(pass?.once?.code, '123456')
  // The authorize request in flight rides in the SEAL, so a leaked link cannot
  // be re-aimed at a stranger's page.
  assertEquals(pass?.once?.q, 'a=b')
  assert(!url.includes('a=b'))
  assertEquals(await passOf(t, ELSE), null)
})

Deno.test('following the link spends the code, and nothing spends it twice', async () => {
  let at = store()
  let code = (await mint(at, SECRET, ME))!
  let t = new URL(await onceLink(SECRET, { email: ME, code })).searchParams
    .get('t')!
  let pass = await passOf(t, SECRET)
  assert(await spend(at, SECRET, pass!.once!.email, pass!.once!.code))
  // The same link again, and the code it was said as: both dead.
  assertEquals(await spend(at, SECRET, ME, code), false)
})

Deno.test('a standing link lives to its expiry, and not past it', async () => {
  let now = Date.now()
  let { standing, url } = await stand(SECRET, book(), { person: 'p1' }, now)
  assertEquals(standing.exp, Math.floor(now / 1000) + DAYS * 86_400)
  assert(url.startsWith('https://yaks.app/login/link?t='))
  assertEquals(
    (await passOf(new URL(url).searchParams.get('t')!, SECRET))?.standing?.id,
    standing.id,
  )
})

Deno.test('a standing link needs its row: revoked, expired, or somebody else’s', async () => {
  let shelf = book()
  let now = Date.now()
  let { standing } = await stand(SECRET, shelf, { person: 'p1', days: 2 }, now)
  assertEquals(await whose(standing, shelf, now), 'p1')
  // Past its own expiry it opens nothing, row or no row.
  assertEquals(await whose(standing, shelf, now + 3 * 86_400_000), null)
  // A pass naming another person finds no row at all: the person is in the key.
  assertEquals(await whose({ ...standing, person: 'p2' }, shelf, now), null)
  // Nowhere to write one down is nowhere to take it back from.
  assertEquals(await whose(standing, null, now), null)
  // Revoked by the front of its id, and dead the moment the row goes.
  assertEquals(await revoke(shelf, 'p1', standing.id.slice(0, 4)), [
    standing.id,
  ])
  assertEquals(await whose(standing, shelf, now), null)
  assertEquals(await revoke(shelf, 'p1', 'nothing'), [])
})

Deno.test('a life outside the ceiling is refused, never clamped', async () => {
  let shelf = book()
  for (let days of [0, -1, MOST + 1]) {
    await assertRejects(() => stand(SECRET, shelf, { person: 'p1', days }))
  }
  assert((await stand(SECRET, shelf, { person: 'p1', days: MOST })).standing)
})

Deno.test('nothing but a well-formed pass under this secret opens', async () => {
  assertEquals(await passOf('', SECRET), null)
  assertEquals(await passOf('not a token', SECRET), null)
  // Sealed by us, and still not a pass: neither half is whole.
  for (
    let junk of [
      {},
      { once: { email: ME } },
      { standing: { id: 'a', person: 'p1' } },
    ]
  ) assertEquals(await passOf(await seal(junk, SECRET), SECRET), null)
  // And a store row is not a link: what it keeps is a mac, never the digits.
  assert((await mac(ME, '123456', SECRET)) != '123456')
  assertEquals(links(undefined), null)
})
