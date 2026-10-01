// An owner's /spawn puts a creature at a connected hero's feet, and the row
// it writes is a creature the page fights at that hero's level, counted from
// their falls and quests.
import { test } from '@yaks/testing'
import { assertEquals, assertStringIncludes } from '@std/assert'
import type { Bundle } from './net.ts'
import { beastId } from './beasts.ts'
import { fighter } from './danger.ts'
import { heroLevel, ROAM, spawnedNear } from './spawn.ts'
import { flat } from './terrain.ts'
import { workerOf } from './worker.js'
import { seedDesigns } from './designs_fixture.ts'
import { keysOf, rows as beastRows } from './beasts_fixture.ts'
import { rows as themeRows } from './themes_fixture.ts'
import { rows as planRows } from './buildings_fixture.ts'

seedDesigns()

let store = (hero: Bundle[]) => {
  let wrote: Bundle[] = []
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
      : path.startsWith('query?live=1')
      ? hero
      : []
  let env = {
    STORE: {
      fetch: (path: string, init?: RequestInit) => {
        if (path.startsWith('query?')) {
          return Promise.resolve(Response.json(answer(path)))
        }
        wrote.push(...JSON.parse(String(init?.body)).entities)
        return Promise.resolve(Response.json({ ok: true }))
      },
    },
  }
  let ask = (role: string, beast: string) =>
    workerOf(flat(5)).fetch(
      new Request('https://yourname.yaks.app/vale/spawn', {
        method: 'POST',
        headers: { 'x-yak-role': role, 'content-type': 'application/json' },
        body: JSON.stringify({ player: 'hero', beast }),
      }),
      env,
    )
  return { wrote, ask }
}
let playing = [{
  entity: { eid: 'hero' },
  position: { level: 'mossvale', x: 50, z: 52 },
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

test('/spawn puts the named creature at the hero, at their level', async () => {
  let { wrote, ask } = store(playing)
  let lvl = heroLevel(kills, [])
  let said = await ask('owner', 'beast:boar')
  assertEquals(said.status, 200)
  assertStringIncludes(await said.text(), `level ${lvl}`)
  let boar = beastId('beast:boar')!
  assertEquals(wrote.map((r) => r.spawned), [
    { beast: boar, lvl, x: 50, z: 52, roam: ROAM },
  ])
  assertEquals((wrote[0].place as { level: string }).level, 'mossvale')
  let [home] = spawnedNear(wrote, 50, 50, 30)
  assertEquals(fighter(home.beast, home.lvl!)?.lvl, lvl)
})

test('/spawn refuses an editor, an unknown creature and an absent hero', async () => {
  let { wrote, ask } = store(playing)
  assertEquals((await ask('editor', 'beast:boar')).status, 403)
  assertEquals((await ask('owner', 'gryphon')).status, 404)
  let away = store([])
  assertEquals((await away.ask('owner', 'beast:boar')).status, 404)
  assertEquals([...wrote, ...away.wrote], [])
})
