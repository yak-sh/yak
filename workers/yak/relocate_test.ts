import { equal, test } from '@yaks/testing'
import { ownedBy } from './directory-fixture.ts'
import { evicted } from '@yaks/durable-object'
import { appStore, directory, fetch as directoryFetch } from './directory.ts'
import { PLATFORM_OBJECT, storeOf } from './door.ts'
import { PLATFORM_STORE } from '@yaks/platform/names'
import type { Env } from './env.ts'
import { KERNEL, metaOf } from './meta.ts'
import { COPY, LEAVE, type Relocating, relocation } from './relocate.ts'
import { platform as probe, seeded as ada } from './serving-probe.ts'
import { platform, slot } from './testing.ts'

let asked = (env: Env, query: string) =>
  storeOf(env.STORE, PLATFORM_STORE)(
    `${LEAVE}?${query}`,
    { method: 'POST' },
    KERNEL,
  )

let leave = async (env: Env, to: string) => {
  let ready = await asked(env, `prepare=${to}`)
  if (!ready.ok) return ready
  return await asked(env, `to=${to}`)
}

// The object of this name, asked as the directory it now holds.
let held = (env: Env, name: string, path: string) =>
  env.STORE!.get(env.STORE!.idFromName(name)).fetch(
    new Request(`http://store${path}`, {
      headers: { ...KERNEL, 'x-store': PLATFORM_STORE },
    }),
  )

let seeded = async (p: { env: Env }) => {
  let dir = directory({ fetch: (r) => directoryFetch(r, p.env) })
  let space = await ownedBy(dir, 'mover', 'moving')
  return { dir, space }
}

test('the directory moves to a new object and every request follows it', async () => {
  await using p = platform('relocate')
  let { dir } = await seeded(p)
  let left = p.states.get(PLATFORM_OBJECT)!
  let durable = false
  let synced: unknown
  Object.assign(left.storage, {
    sync: async () => {
      synced = await left.storage.get('relocating')
      await Promise.resolve()
      durable = true
    },
  })
  Object.assign(left, {
    abort: (reason: string) => {
      equal(durable, true)
      equal(synced, { to: 'yak/ord', tries: 0, store: PLATFORM_STORE })
      equal(evicted(new Error(reason)), true)
    },
  })
  let r = await leave(p.env, 'yak/ord')
  let report = await r.json()
  if (r.status != 200) throw new Error(JSON.stringify(report).slice(0, 1500))
  equal(report.to, 'yak/ord')
  // Both ends tallied every table alike, the rows counted among them.
  equal(report.rows > 0, true)

  // Reached at the old address, the directory still answers, and its writes
  // land in the new object rather than the rows left behind.
  equal((await dir.space('moving'))?.slug, 'moving')
  let more = await ownedBy(dir, 'second', 'second')
  equal(more.slug, 'second')
  let there = await held(
    p.env,
    'yak/ord',
    `/query?q=${encodeURIComponent('.space.slug=second')}`,
  )
  equal(there.status, 200)
  equal(JSON.stringify(await there.json()).includes('second'), true)
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
  equal((await ownedBy(dir, 'after', 'after')).slug, 'after')

  equal((await leave(p.env, 'yak/ord')).status, 200)
  equal((await dir.space('after'))?.slug, 'after')
})

test('what moved after the copy reaches the new object in the hold', async () => {
  await using p = platform('relocate delta')
  let { dir } = await seeded(p)
  equal((await asked(p.env, 'prepare=yak/ord')).status, 200)
  // Nothing has changed hands yet, and nothing boots at the far end.
  equal((await ownedBy(dir, 'during', 'during')).slug, 'during')
  equal(slot(p.states.get(PLATFORM_OBJECT)!, 'name'), PLATFORM_STORE)
  equal(await p.states.get('yak/ord')!.storage.getAlarm(), null)

  let r = await asked(p.env, 'to=yak/ord')
  let said = await r.json()
  equal(r.status, 200, JSON.stringify(said))
  equal(said.resent > 0, true)
  let there = await held(
    p.env,
    'yak/ord',
    `/query?q=${encodeURIComponent('.space.slug=during')}`,
  )
  equal(JSON.stringify(await there.json()).includes('during'), true)
})

test('a hold with nothing prepared leaves the directory serving', async () => {
  await using p = platform('relocate unprepared')
  let { dir, space } = await seeded(p)
  equal((await asked(p.env, 'to=yak/ord')).status, 500)
  equal((await dir.space('moving'))?.eid, space.eid)
  let left = p.states.get(PLATFORM_OBJECT)!
  equal(await left.storage.get('relocating'), false)
  equal(await left.storage.get('dormant'), false)
  equal((await ownedBy(dir, 'after', 'after')).slug, 'after')
})

test('the way back returns requests to the old object', async () => {
  await using p = platform('relocate back')
  let { dir } = await seeded(p)
  equal((await leave(p.env, 'yak/ord')).status, 200)
  let r = await asked(p.env, 'back=1')
  equal(r.status, 200)
  equal((await ownedBy(dir, 'home', 'home')).slug, 'home')
  equal(await p.states.get(PLATFORM_OBJECT)!.storage.get('dormant'), false)
})

test('a restart at the new object is sent again, body and all', async () => {
  let sent: string[] = []
  let answer = relocation({
    storage: () =>
      ({
        get: (key: string) =>
          Promise.resolve(key == 'relocated' ? 'yak/ord' : undefined),
      }) as unknown as Relocating,
    object: () => ({
      fetch: async (req) => {
        sent.push(await req.text())
        if (sent.length == 1) {
          throw new Error(
            'Durable Object reset because a newer deploy reached it: x',
          )
        }
        return new Response('landed')
      },
    }),
    leave: () => Promise.resolve(),
    resume: () => {},
    report: (e) => {
      throw e
    },
  })
  let r = await answer(
    new Request('http://store/apply', {
      method: 'POST',
      headers: { 'x-store': PLATFORM_STORE },
      body: 'write',
    }),
  )
  equal(await r!.text(), 'landed')
  equal(sent, ['write', 'write'])
})

test('a copy of an app store stands under its own name, owing nothing, while the source serves', async () => {
  await using p = probe()
  let { space, app } = await ada(p.env)
  let source = metaOf(appStore(p.env.STORE, space, app))
  let soon = new Date(Date.now() + 60_000).toISOString()
  await source.apply([
    { entity: { eid: 'water' }, wake: { at: soon, every: '1h' } },
    ...Array.from({ length: 300 }, (_, i) => ({
      entity: { eid: crypto.randomUUID() },
      doc: { title: `sample ${i}` },
    })),
  ], KERNEL)
  await source.apply([{
    entity: { eid: 'owed' },
    effect: { handler: 'nobody/mails', state: 'pending' },
  }], KERNEL)
  let copied = (to: string) =>
    storeOf(p.env.STORE, app.store!)(
      `${COPY}?to=${encodeURIComponent(to)}`,
      { method: 'POST' },
      KERNEL,
    )
  let r = await copied('visit/one')
  let report = await r.json()
  equal(r.status, 200)
  equal(report.rows > 300, true)

  let copy = p.states.get('visit/one')!
  equal(slot(copy, 'name'), 'visit/one')
  equal(await copy.storage.getAlarm(), null)
  let there = metaOf(
    appStore(p.env.STORE, space, { ...app, store: 'visit/one' }),
  )
  let titles = async (m: typeof source) =>
    (await m.query('.doc')).map((b) => b.entity.eid).sort()
  equal(await titles(there), await titles(source))
  equal((await there.query('.wake'))[0].wake, { at: soon, every: '1h' })
  equal(await there.query('.effect'), [])
  equal(slot(copy, 'copied'), null)
  equal((await source.query('.effect')).length, 1)
  equal(slot(p.states.get(app.store!)!, 'name'), app.store)

  // A name already serving is never written over, the source's own included.
  equal((await copied('visit/one')).status, 500)
  equal((await copied(app.store!)).status, 500)
  equal(await titles(there), await titles(source))
})
