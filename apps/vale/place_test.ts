// A command sees a live position when a page is playing, then the saved place.
import { test } from '@yaks/testing'
import { assertEquals, assertStringIncludes } from '@std/assert'
import { flat } from './terrain.ts'
import { placeOf } from './place.ts'
import { seedDesigns } from './designs_fixture.ts'

seedDesigns()

test('a connected position can name a generated land', () => {
  let where = { level: 'frontier_20_20', x: 5248, z: 5248 }
  assertEquals(placeOf({ position: where }, 'position'), where)
})
import { workerOf } from './worker.js'
import { useThemes } from './levels.ts'
import { rows as themeRows } from './themes_fixture.ts'
import { rows as planRows } from './buildings_fixture.ts'

test('where returns a live position, then the saved spot, to its owner', async () => {
  let live = true
  let asked: string[] = []
  let env = {
    STORE: {
      fetch: (path: string) => {
        asked.push(path)
        if (path.startsWith('query?live=1')) {
          return Promise.resolve(Response.json(
            live
              ? [{
                entity: { eid: 'hero' },
                position: { level: 'mossvale', x: 51, z: 52, at: 1000 },
              }]
              : [],
          ))
        }
        if (path.includes('.theme_design')) {
          return Promise.resolve(Response.json(themeRows))
        }
        if (path.includes('.building_design')) {
          return Promise.resolve(Response.json(planRows))
        }
        return Promise.resolve(Response.json([{
          entity: { eid: 'hero' },
          player: {},
          created: { by: 'person' },
          seen: {
            level: 'mossvale',
            x: 50,
            z: 50,
            at: '2026-09-28T00:00:00.000Z',
          },
        }]))
      },
    },
  }
  let ask = (person: string) =>
    new Request('https://yourname.yaks.app/vale/where', {
      method: 'POST',
      headers: { 'x-yak-person': person },
      body: JSON.stringify({ player: 'hero' }),
    })
  // A fresh worker knows no land until it reads the store's themes.
  useThemes([])
  let worker = workerOf(flat(5))
  let first = await worker.fetch(ask('person'), env)
  assertEquals(first.status, 200)
  assertStringIncludes(await first.text(), 'Live position: **Mossvale**')
  live = false
  let saved = await worker.fetch(ask('person'), env)
  assertEquals(saved.status, 200)
  assertStringIncludes(await saved.text(), 'Last saved position: **Mossvale**')
  let denied = await worker.fetch(ask('other'), env)
  assertEquals(denied.status, 403)
  assertEquals(
    asked.filter((path) => path.startsWith('query?live=1')).length,
    2,
  )
})
