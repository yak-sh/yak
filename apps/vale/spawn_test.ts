// A signed-in person's /spawn puts a creature ahead of their connected hero, and the row
// it writes is a creature the page fights at that hero's level, counted from
// their falls and quests.
import { test } from '@yaks/testing'
import { parse } from '@yaks/query'
import { frontOf } from './spawn.ts'
import { assertEquals, assertStringIncludes } from '@std/assert'
import type { Bundle } from './net.ts'
import { beastId } from './beasts.ts'
import { fighter } from './danger.ts'
import {
  heroLevel,
  kindOf,
  pendingSpawns,
  ROAM,
  SPAWN_KINDS,
  spawnedNear,
  useSpawnKinds,
} from './spawn.ts'
import { flat } from './terrain.ts'
import { workerOf } from './worker.js'
import { seedDesigns } from './designs_fixture.ts'
import { keysOf, rows as beastRows } from './beasts_fixture.ts'
import { rows as themeRows } from './themes_fixture.ts'
import { rows as planRows } from './buildings_fixture.ts'

seedDesigns()

let store = (hero: Bundle[]) => {
  let wrote: Bundle[] = []
  let queries: string[] = []
  let answer = (path: string): unknown =>
    path.includes('.theme_design')
      ? themeRows
      : path.includes('.building_design')
      ? planRows
      : path.includes('.beast_design')
      ? beastRows.filter((r) => r.beast_design)
      : path.includes('.key')
      ? keysOf(beastRows)
      : path.includes('.slain')
      ? kills
      : path.includes('.journal')
      ? []
      : path.includes('.player') && path.includes('.created.by')
      ? [{ entity: { eid: 'hero' }, player: {} }]
      : path.startsWith('query?live=1')
      ? hero
      : []
  let env = {
    STORE: {
      fetch: (path: string, init?: RequestInit) => {
        if (path.startsWith('query?')) {
          queries.push(decodeURIComponent(path))
          return Promise.resolve(
            Response.json(answer(decodeURIComponent(path))),
          )
        }
        wrote.push(...JSON.parse(String(init?.body)).entities)
        return Promise.resolve(Response.json({ ok: true }))
      },
    },
  }
  let ask = (role: string, beast: string, at?: string, person = 'person') =>
    workerOf(flat(5)).fetch(
      new Request('https://yourname.yaks.app/vale/spawn', {
        method: 'POST',
        headers: {
          'x-yak-role': role,
          'x-yak-person': person,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ beast, ...(at ? { at } : {}) }),
      }),
      env,
    )
  return { wrote, ask, queries }
}
let playing = [{
  entity: { eid: 'hero' },
  position: { level: 'mossvale', x: 50, z: 52 },
  motion: { yaw: Math.PI / 2 },
}]
let kills: Bundle[] = Array.from({ length: 40 }, (_, i) => ({
  entity: { eid: `fall${i}` },
  slain: {
    creature: `c${i}`,
    by: 'hero',
    beast: beastId('beast:boar')!,
    at: i,
    xp: 34,
  },
}))

test('/spawn lets a nonowner person spawn in front of their connected hero, at their level', async () => {
  let { wrote, ask, queries } = store(playing)
  let lvl = heroLevel(kills, [])
  let said = await ask('person', 'beast:boar')
  assertEquals(said.status, 200)
  assertEquals(queries.some((q) => q.includes('.created.by="person"')), true)
  assertEquals(
    queries.some((q) => q.includes('.entity.eid="hero"&.position&?motion')),
    true,
  )
  assertStringIncludes(await said.text(), `level ${lvl}`)
  let boar = beastId('beast:boar')!
  assertEquals(wrote.map((r) => r.spawned), [
    { beast: boar, lvl, x: 53, z: 52, roam: ROAM },
  ])
  assertEquals((wrote[0].place as { level: string }).level, 'mossvale')
  let [home] = spawnedNear(wrote, 50, 50, 30)
  assertEquals(fighter(home.beast, home.lvl!)?.lvl, lvl)
})

test('/spawn refuses an unsigned caller and an absent hero', async () => {
  let { wrote, ask } = store(playing)
  assertEquals((await ask('visitor', 'beast:boar', undefined, '')).status, 403)
  let away = store([])
  assertEquals((await away.ask('person', 'beast:boar')).status, 404)
  assertEquals([...wrote, ...away.wrote], [])
})

test('/spawn keeps a description at the hero until its current main kind', async () => {
  let { wrote, ask } = store(playing)
  let said = await ask('owner', 'a spider with a tophat')
  assertEquals(said.status, 200)
  assertStringIncludes(await said.text(), 'shimmers in front of you')
  assertEquals(wrote[0].doc, { body: 'a spider with a tophat' })
  assertEquals(wrote[0].spawned, {
    lvl: heroLevel(kills, []),
    x: 53,
    z: 52,
    roam: ROAM,
  })
  assertEquals(spawnedNear(wrote, 50, 52, 30), [])
  let eid = wrote[0].entity.eid
  useSpawnKinds([
    {
      entity: { eid: 'shadow' },
      built: {
        current: true,
        slot: 'kind',
        build: 'shadow-build',
      },
    },
    { entity: { eid: 'shadow-build' }, build: { variant: 'shadow', for: eid } },
  ])
  assertEquals(kindOf(wrote[0]), undefined)
  assertEquals(pendingSpawns(wrote, () => false).length, 1)
  useSpawnKinds([
    {
      entity: { eid: 'minted-kind' },
      built: {
        current: true,
        slot: 'kind',
        build: 'main-build',
      },
    },
    { entity: { eid: 'main-build' }, build: { variant: 'main', for: eid } },
  ])
  assertEquals(kindOf(wrote[0]), 'minted-kind')
  assertEquals(spawnedNear(wrote, 50, 52, 30)[0].beast, 'minted-kind')
  assertEquals(pendingSpawns(wrote, () => false).length, 1)
  assertEquals(pendingSpawns(wrote, (b) => b == 'minted-kind'), [])
  useSpawnKinds([])
  assertEquals(kindOf(wrote[0]), undefined)
})

test('hosted projected kind rows resolve the main creature at its saved home', () => {
  parse(SPAWN_KINDS)
  let rows = [
    {
      entity: { eid: 'kind' },
      built: { current: true, slot: 'kind', build: 'build' },
    },
    { entity: { eid: 'build' }, build: { variant: 'main', for: 'spawn' } },
    { entity: { eid: 'spawn' }, spawned: { lvl: 7 } },
  ]
  useSpawnKinds(rows)
  assertEquals(
    kindOf({ entity: { eid: 'spawn' }, spawned: { lvl: 7 } }),
    'kind',
  )
  useSpawnKinds([])
})

test('spawn offset follows facing in each cardinal direction', () => {
  for (
    let [yaw, x, z] of [[0, 10, 23], [Math.PI / 2, 13, 20], [Math.PI, 10, 17], [
      -Math.PI / 2,
      7,
      20,
    ]]
  ) {
    let at = frontOf({ x: 10, z: 20 }, yaw)
    assertEquals([Math.round(at.x), Math.round(at.z)], [x, z])
  }
})

test('spawn at uses existing land and entity destinations instead of the offset', async () => {
  for (let target of ['mossvale', '01234567-89ab-cdef-0123-456789abcdef']) {
    let { ask, wrote } = store(playing)
    let said = await ask('owner', 'boar', target)
    assertEquals(said.status, 200)
    if (target != 'mossvale') {
      assertEquals(wrote[0].spawned?.x, 50)
      assertEquals(wrote[0].spawned?.z, 52)
    }
  }
  assertEquals(
    (await store(playing).ask('owner', 'boar', 'unknown')).status,
    404,
  )
  assertEquals(
    (await store(playing).ask('owner', 'boar', undefined, '')).status,
    403,
  )
})
