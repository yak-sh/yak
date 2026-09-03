// The sign-in code's decisions, at the seam: signin.ts talks to the meta
// store through one Door, so a stub Door holds the rows and records the
// bundles. What is proved here is what a workerd test cannot reach without
// waiting ten minutes or forging a server-stamped column: a code dies of old
// age, a code dies of too many guesses, a code minted for one address never
// opens another, and an address gets three letters an hour — a window no test
// can sit through, and a count nobody buys back by burning a code.
import { assert, assertEquals, assertFalse } from '@std/assert'
import {
  chose,
  LIFE,
  mac,
  mint,
  nameOf,
  personOf,
  SENDS,
  spend,
  TRIES,
  WINDOW,
} from './signin.ts'
import type { Door } from './store.ts'

let n = 0
let row = (
  email: string,
  code: string,
  expires: string,
  tries = 0,
) => ({ entity: { eid: `e${++n}` }, signin: { email, code, expires, tries } })

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

// The guess count each patched row was left holding.
let tries = (wrote: Record<string, unknown>[]) =>
  wrote.flatMap((b) =>
    ((b as { entities?: { signin?: { tries?: number } }[] }).entities ?? [])
      .map((e) => e.signin?.tries).filter((t) => t != null)
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
  assertEquals(tries(d.wrote), [1])
})

Deno.test('the last guess burns the code, and leaves its record', async () => {
  let burnt = row(ME, await mac(ME, '123456', SECRET), soon(), TRIES - 1)
  let d = door([burnt])
  assertFalse(await spend(d.at, SECRET, ME, '654321'))
  assertEquals(tries(d.wrote), [TRIES])
  // The row stays: it is one of the three letters this hour, and burning a
  // code is not how anyone buys a fourth.
  assertFalse(forgotten(d.wrote))
  // And it opens nothing now, right digits or not.
  let after = door([{ ...burnt, signin: { ...burnt.signin, tries: TRIES } }])
  assertFalse(await spend(after.at, SECRET, ME, '123456'))
  assertEquals(after.wrote.length, 0)
})

Deno.test('an expired code opens nothing, right digits or not', async () => {
  let d = door([row(ME, await mac(ME, '123456', SECRET), past())])
  assertFalse(await spend(d.at, SECRET, ME, '123456'))
  assertEquals(d.wrote.length, 0)
})

// Several codes can stand for one address at once, because the store keeps a
// mac and never the digits: a second ask cannot re-send the first letter's
// code, so the first letter is left working for whoever it reaches late.
Deno.test('every standing code opens, and one guess costs them all', async () => {
  let both = async () => [
    row(ME, await mac(ME, '111111', SECRET), soon()),
    row(ME, await mac(ME, '222222', SECRET), soon()),
  ]
  for (let code of ['111111', '222222']) {
    let d = door(await both())
    assert(await spend(d.at, SECRET, ME, code), code)
    assert(forgotten(d.wrote))
  }
  let d = door(await both())
  assertFalse(await spend(d.at, SECRET, ME, '333333'))
  assertEquals(tries(d.wrote), [1, 1])
})

// The ceiling. A row outlives its code as the record that a letter went out,
// and `expires` minus LIFE is when that was.
let record = (ago: number) => ({
  entity: { eid: `e${++n}` },
  signin: {
    email: ME,
    code: 'x'.repeat(64),
    expires: new Date(Date.now() - ago + LIFE).toISOString(),
    tries: TRIES,
  },
})

let minted = (wrote: Record<string, unknown>[]) =>
  wrote.flatMap((b) =>
    ((b as { entities?: { signin?: { code?: string } }[] }).entities ?? [])
      .filter((e) => e.signin?.code)
  )

Deno.test('three letters an hour to one address, and no more', async () => {
  let under = door([record(0), record(60_000)])
  assert(await mint(under.at, SECRET, ME))
  assertEquals(minted(under.wrote).length, 1)

  let full = door(Array.from({ length: SENDS }, () => record(60_000)))
  assertEquals(await mint(full.at, SECRET, ME), null)
  assertEquals(minted(full.wrote).length, 0)
  assertFalse(forgotten(full.wrote))
})

Deno.test('the window passes and the address may ask again', async () => {
  let old = Array.from({ length: SENDS }, () => record(WINDOW + 60_000))
  let d = door(old)
  assert(await mint(d.at, SECRET, ME))
  // Swept, since nothing else ever sweeps them.
  assert(forgotten(d.wrote))
  assertEquals(minted(d.wrote).length, 1)
})

Deno.test('signing in clears the count', async () => {
  let full = [
    ...Array.from({ length: SENDS - 1 }, () => record(60_000)),
    row(ME, await mac(ME, '123456', SECRET), soon()),
  ]
  let d = door(full)
  assert(await spend(d.at, SECRET, ME, '123456'))
  assertEquals(
    (d.wrote[0] as { entities: unknown[] }).entities.length,
    full.length,
  )
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
