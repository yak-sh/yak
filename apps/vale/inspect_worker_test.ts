// An admin sees a short command answer from stored and live rows; other
// visitors cannot use the store-backed inspection door.
import { test } from '@yaks/testing'
import { assertEquals, assertStringIncludes } from '@std/assert'
import { flat } from './terrain.ts'
import { eidOf } from './villager-id.ts'
import { workerOf } from './worker.js'
import { rows as themeRows } from './themes_fixture.ts'
import { seedDesigns } from './designs_fixture.ts'

seedDesigns()

let HERO = '01234567-89ab-cdef-0123-456789abcdef'
let hero = {
  entity: { eid: HERO },
  player: {},
  created: { by: 'owner-person' },
  seen: { level: 'mossvale', x: 10, z: 20 },
}
let look = {
  entity: { eid: 'look' },
  look: { player: HERO, name: 'Bramble', at: 1 },
}
let ask = {
  entity: { eid: 'ask' },
  directive: { player: HERO, goal: 'wood', count: 4 },
  created: { by: 'owner-person', at: '2026-09-28T00:00:00Z' },
  companion: { status: 'walking', x: 10, z: 20 },
}
let project = (row: Record<string, unknown>, line: string) =>
  Object.fromEntries(
    Object.entries(row).filter(([name]) =>
      name == 'entity' || line.includes(`?${name}`) || line.includes(`.${name}`)
    ),
  )

test('inspect worker checks owner and reads live hero state', async () => {
  let reads: string[] = []
  let env = {
    STORE: {
      fetch: (path: string) => {
        let url = new URL(path, 'https://store.test/')
        let line = url.searchParams.get('q') ?? ''
        reads.push(line)
        let rows = line == '.theme_design'
          ? themeRows
          : url.searchParams.has('live')
          ? [{
            entity: { eid: HERO },
            position: { level: 'mossvale', x: 10, z: 20 },
          }]
          : line.startsWith('.look.name~=') ||
              line.startsWith('.look.player=')
          ? [look]
          : line.startsWith('.directive.player=')
          ? [ask]
          : line.startsWith('.gathered.directive=')
          ? [{ entity: { eid: 'log' }, gathered: { directive: 'ask' } }]
          : line.startsWith('.eid=')
          ? [project(hero, line)]
          : []
        return Promise.resolve(Response.json(rows))
      },
    },
  }
  let worker = workerOf(flat(5))
  let request = (role: string) =>
    new Request('https://yourname.yaks.app/vale/inspect', {
      method: 'POST',
      headers: { 'x-yak-role': role, 'content-type': 'application/json' },
      body: JSON.stringify({ target: 'Bramble' }),
    })
  let refused = await worker.fetch(request('viewer'), env)
  assertEquals(refused.status, 403)
  assertEquals(reads, [])
  let result = await worker.fetch(request('owner'), env)
  assertEquals(result.status, 200)
  let text = await result.text()
  assertStringIncludes(text, 'Hero `' + HERO + '`')
  assertStringIncludes(text, 'Position now: Mossvale (10, 20)')
  assertStringIncludes(text, 'Companion: wood 1/4')
  assertEquals(text.includes('owner-person'), false)
})

test('inspect worker resolves land and villager names', async () => {
  let worker = workerOf(flat(5))
  let elder = {
    entity: { eid: eidOf('wren') },
    doc: { title: 'Elder Wren' },
    villager: { id: 'wren', level: 'mossvale', home: 'oak grove' },
  }
  let env = {
    STORE: {
      fetch: (path: string) => {
        let line = new URL(path, 'https://store.test/').searchParams.get('q') ??
          ''
        return Promise.resolve(Response.json(
          line == '.theme_design'
            ? themeRows
            : line.startsWith('.eid=')
            ? [project(elder, line)]
            : [],
        ))
      },
    },
  }
  let ask = (target: string) =>
    worker.fetch(
      new Request('https://yourname.yaks.app/vale/inspect', {
        method: 'POST',
        headers: {
          'x-yak-role': 'owner',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ target }),
      }),
      env,
    )
  let land = await ask('Tomb Sands')
  assertEquals(land.status, 200)
  assertStringIncludes(await land.text(), 'Land `tombsands`')
  let villager = await ask('Elder Wren')
  assertEquals(villager.status, 200)
  let text = await villager.text()
  assertStringIncludes(text, 'Elder Wren')
  assertStringIncludes(text, 'Villager `')
  assertStringIncludes(text, 'Home: Mossvale')
})
