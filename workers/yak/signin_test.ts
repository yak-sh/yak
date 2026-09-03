// The sign-in code's decisions, at the seam: signin.ts talks to the meta
// store through one Door, so a stub Door holds the rows and records the
// bundles. What is proved here is what a workerd test cannot reach without
// waiting ten minutes or forging a server-stamped column: a code dies of old
// age, a code dies of too many guesses, and a code minted for one address
// never opens another.
import { assert, assertEquals, assertFalse } from '@std/assert'
import { chose, mac, nameOf, personOf, spend, TRIES } from './signin.ts'
import type { Door } from './store.ts'

let row = (
  email: string,
  code: string,
  expires: string,
  tries = 0,
) => ({ entity: { eid: 'e1' }, signin: { email, code, expires, tries } })

let door = (rows: unknown[]) => {
  let wrote: Record<string, unknown>[] = []
  let at: Door = (path, init) => {
    if (path.startsWith('/query')) return Promise.resolve(Response.json(rows))
    wrote.push(JSON.parse(String(init?.body)))
    // What a mint gets back: the eid the store gave the `$who` the bundle
    // asked for (D-23827).
    return Promise.resolve(Response.json({ ok: true, aliases: { $who: 'p1' } }))
  }
  return { at, wrote }
}

let soon = () => new Date(Date.now() + 60_000).toISOString()
let past = () => new Date(Date.now() - 1).toISOString()

let SECRET = 'a probe secret'
let ME = 'me@yaks.app'

// A bundle that buries the entity: the tombstone spelling of death.
let forgotten = (wrote: Record<string, unknown>[]) =>
  wrote.some((b) =>
    ((b as { entities?: { tombstone?: unknown }[] }).entities ?? [])
      .some((e) => e.tombstone)
  )

Deno.test('the live code opens, and is spent', async () => {
  let d = door([row(ME, await mac(ME, '123456', SECRET), soon())])
  assert(await spend(d.at, SECRET, ME, '123456'))
  assert(forgotten(d.wrote))
})

Deno.test('a wrong guess costs a try, not the code', async () => {
  let d = door([row(ME, await mac(ME, '123456', SECRET), soon())])
  assertFalse(await spend(d.at, SECRET, ME, '654321'))
  assertFalse(forgotten(d.wrote))
  assertEquals(
    (d.wrote[0] as { entities: { signin: { tries: number } }[] })
      .entities[0].signin.tries,
    1,
  )
})

Deno.test('the last guess burns the code', async () => {
  let d = door([
    row(ME, await mac(ME, '123456', SECRET), soon(), TRIES - 1),
  ])
  assertFalse(await spend(d.at, SECRET, ME, '654321'))
  assert(forgotten(d.wrote))
})

Deno.test('an expired code opens nothing, right digits or not', async () => {
  let d = door([row(ME, await mac(ME, '123456', SECRET), past())])
  assertFalse(await spend(d.at, SECRET, ME, '123456'))
  assert(forgotten(d.wrote))
})

Deno.test('a code belongs to its address', async () => {
  // The address is inside the mac, so the row's own email cannot be edited
  // into someone else's sign-in.
  let d = door([row('you@yaks.app', await mac(ME, '123456', SECRET), soon())])
  assertFalse(await spend(d.at, SECRET, 'you@yaks.app', '123456'))
})

Deno.test('no code at all is no sign-in', async () => {
  let d = door([])
  assertFalse(await spend(d.at, SECRET, ME, '123456'))
  assertEquals(d.wrote.length, 0)
})

// What a person is called. An address is never it: the platform's own older
// rows are titled with one (T-32627), so such a title reads as no name — the
// next sign-in asks, and an app's store is written the front of the address
// meanwhile (T-32654).
Deno.test('a name, never an address', () => {
  assertEquals(nameOf('Dana', ME), 'Dana')
  assertEquals(nameOf(null, ME), 'me')
  assertEquals(nameOf('', 'Dana@Example.com'), 'dana')
  assertEquals(nameOf(ME, ME), 'me')
  assertEquals(chose(ME), null)
  assertEquals(chose('Dana'), 'Dana')
})

let person = (title?: string) => ({
  entity: { eid: 'p1' },
  person: {},
  ...(title ? { doc: { title } } : {}),
})

let titles = (wrote: Record<string, unknown>[]) =>
  wrote.flatMap((b) =>
    ((b as { entities?: { doc?: { title?: string } }[] }).entities ?? [])
      .map((e) => e.doc?.title).filter(Boolean)
  )

Deno.test('a person nobody has named keeps no title', async () => {
  let d = door([])
  await personOf(d.at, ME)
  assertEquals(titles(d.wrote), [])
})

Deno.test('an invitation names someone unnamed, and only them', async () => {
  let fresh = door([])
  await personOf(fresh.at, ME, 'Dana')
  assertEquals(titles(fresh.wrote), ['Dana'])
  // A row wearing the old address-as-title has no name yet, so it takes one.
  let old = door([person(ME)])
  await personOf(old.at, ME, 'Dana')
  assertEquals(titles(old.wrote), ['Dana'])
  // A name they chose is theirs; nobody else's invitation moves it.
  let named = door([person('Dana')])
  await personOf(named.at, ME, 'Someone else')
  assertEquals(named.wrote.length, 0)
})
