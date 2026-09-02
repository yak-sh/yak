// The sign-in code's decisions, at the seam: signin.ts talks to the meta
// store through one Door, so a stub Door holds the rows and records the
// bundles. What is proved here is what a workerd test cannot reach without
// waiting ten minutes or forging a server-stamped column: a code dies of old
// age, a code dies of too many guesses, and a code minted for one address
// never opens another.
import { assert, assertEquals, assertFalse } from '@std/assert'
import { mac, spend, TRIES } from './signin.ts'
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
    return Promise.resolve(Response.json({ ok: true }))
  }
  return { at, wrote }
}

let soon = () => new Date(Date.now() + 60_000).toISOString()
let past = () => new Date(Date.now() - 1).toISOString()

let SECRET = 'a probe secret'
let ME = 'me@yaks.app'

// A batch that removes the entity, whatever door it went through.
let forgotten = (wrote: Record<string, unknown>[]) =>
  wrote.some((b) =>
    Array.isArray(b) &&
    b.some((c) => c.name == 'entity' && c.comp === null)
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
