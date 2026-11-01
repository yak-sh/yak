import { equal, test } from '@yaks/testing'
import { directory, fetch as directoryFetch } from './directory.ts'
import { PLATFORM_STORE, storeOf } from './door.ts'
import type { Env } from './env.ts'
import { KERNEL } from './meta.ts'
import { LEAVE } from './relocate.ts'
import { platform, slot } from './testing.ts'

let leave = (env: Env, to: string) =>
  storeOf(env.STORE, PLATFORM_STORE)(
    `${LEAVE}?to=${encodeURIComponent(to)}`,
    { method: 'POST' },
    KERNEL,
  )

// The object of this name, asked as the directory it now holds.
let held = (env: Env, name: string, path: string) =>
  env.STORE!.get(env.STORE!.idFromName(name)).fetch(
    new Request(`http://store${path}`, {
      headers: { ...KERNEL, 'x-store': PLATFORM_STORE },
    }),
  )

let seeded = async (p: { env: Env }) => {
  let dir = directory({ fetch: (r) => directoryFetch(r, p.env) }, true)
  let space = await dir.own('mover', 'moving')
  return { dir, space }
}

test('the directory moves to a new object and every request follows it', async () => {
  await using p = platform('relocate')
  let { dir } = await seeded(p)
  let r = await leave(p.env, 'yak/ord')
  let report = await r.json()
  if (r.status != 200) throw new Error(JSON.stringify(report).slice(0, 1500))
  equal(report.to, 'yak/ord')
  // Both ends tallied every table alike, the rows counted among them.
  equal(report.rows > 0, true)

  // Reached at the old address, the directory still answers, and its writes
  // land in the new object rather than the rows left behind.
  equal((await dir.space('moving'))?.slug, 'moving')
  let more = await dir.own('second', 'second')
  equal(more.slug, 'second')
  let there = await held(
    p.env,
    'yak/ord',
    `/query?q=${encodeURIComponent('.space.slug=second')}`,
  )
  equal(there.status, 200)
  equal(JSON.stringify(await there.json()).includes('second'), true)
  let left = p.states.get(PLATFORM_STORE)!
  equal(await left.storage.get('dormant'), true)
  equal(await left.storage.get('relocated'), 'yak/ord')
  equal(slot(p.states.get('yak/ord')!, 'name'), PLATFORM_STORE)
})

test('a copy that cannot land leaves the directory serving, and it can try again', async () => {
  await using p = platform('relocate refused')
  let { dir, space } = await seeded(p)
  // An object already serving a store refuses to be copied over.
  let served = storeOf(p.env.STORE, 'yak/git')
  equal((await served('/query?q=.entity', {}, KERNEL)).status, 200)
  let r = await leave(p.env, 'yak/git')
  equal(r.status, 500, await r.clone().text())

  equal((await dir.space('moving'))?.eid, space.eid)
  let left = p.states.get(PLATFORM_STORE)!
  equal(await left.storage.get('relocating'), false)
  equal(await left.storage.get('dormant'), false)
  equal((await dir.own('after', 'after')).slug, 'after')

  equal((await leave(p.env, 'yak/ord')).status, 200)
  equal((await dir.space('after'))?.slug, 'after')
})

test('a rehearsal copies everything and changes nothing here or there', async () => {
  await using p = platform('relocate rehearsal')
  let { dir, space } = await seeded(p)
  let r = await storeOf(p.env.STORE, PLATFORM_STORE)(
    `${LEAVE}?rehearse=yak/try`,
    { method: 'POST' },
    KERNEL,
  )
  let said = await r.json()
  equal(r.status, 200, JSON.stringify(said))
  equal(said.unlike, [])
  equal(said.rows > 0, true)
  equal(said.fts > 0, true)
  equal((await dir.space('moving'))?.eid, space.eid)
  equal(await p.states.get(PLATFORM_STORE)!.storage.get('relocated'), undefined)
  equal(await p.states.get('yak/try')!.storage.getAlarm(), null)
})

test('the way back returns requests to the old object', async () => {
  await using p = platform('relocate back')
  let { dir } = await seeded(p)
  equal((await leave(p.env, 'yak/ord')).status, 200)
  let r = await storeOf(p.env.STORE, PLATFORM_STORE)(
    `${LEAVE}?back=1`,
    { method: 'POST' },
    KERNEL,
  )
  equal(r.status, 200)
  equal((await dir.own('home', 'home')).slug, 'home')
  equal(await p.states.get(PLATFORM_STORE)!.storage.get('dormant'), false)
})
