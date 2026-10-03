// Hero commands resolve current names at their door and keep ownership checks.
import { test } from '@yaks/testing'
import { assertEquals, assertStringIncludes } from '@std/assert'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import type { Bundle } from './net.ts'
import { comp } from './bundle.ts'
import core from '../../packages/kernel/vocab.json' with { type: 'json' }
import words from './vocab.json' with { type: 'json' }
import { workerOf } from './worker.js'
import { flat } from './terrain.ts'
import { rows as themeRows } from './themes_fixture.ts'
import { rows as planRows } from './buildings_fixture.ts'
import { seedDesigns } from './designs_fixture.ts'

seedDesigns()

let HERO = '01234567-89ab-cdef-0123-456789abcdef'
let OTHER = '11234567-89ab-cdef-0123-456789abcdef'
let fixture = async (named = false) => {
  let vocab = loadVocab([core, words])
  let g = graph({ storage: ram(vocab), vocab })
  await g.apply([
    ...themeRows,
    ...planRows,
    {
      entity: { eid: HERO },
      player: {},
      $actor: { by: 'person' },
      position: { level: 'mossvale', x: 50, z: 50 },
    },
    {
      entity: { eid: OTHER },
      player: {},
      $actor: { by: 'other' },
    },
    { entity: { eid: 'old' }, look: { player: HERO, name: 'Old name', at: 1 } },
    { entity: { eid: 'now' }, look: { player: HERO, name: 'Matt', at: 2 } },
    {
      entity: { eid: 'other-look' },
      look: { player: OTHER, name: 'Yaks', at: 3 },
    },
  ])
  let wrote: Bundle[] = []
  let env = {
    STORE: {
      fetch: async (path: string, init?: RequestInit) => {
        if (path == 'apply') {
          let rows = JSON.parse(String(init?.body)).entities
          wrote.push(...rows)
          return Response.json({ bundles: rows })
        }
        let url = new URL(path, 'https://store.test/')
        let rows = url.searchParams.has('live')
          ? []
          : await g.read(url.searchParams.get('q')!)
        // The public store door can spell an author as their eid and name.
        return Response.json(rows.map((row) => {
          let created = comp(row, 'created')
          return named && typeof created.by == 'string'
            ? {
              ...row,
              created: { ...created, by: { eid: created.by, name: 'Owner' } },
            }
            : row
        }))
      },
    },
  }
  let worker = workerOf(flat(5))
  let ask = (
    command: string,
    args: Record<string, unknown>,
    person = 'person',
    role = 'owner',
  ) =>
    worker.fetch(
      new Request(`https://yourname.yaks.app/vale/${command}`, {
        method: 'POST',
        headers: { 'x-yak-person': person, 'x-yak-role': role },
        body: JSON.stringify(args),
      }),
      env,
    )
  return { g, wrote, ask }
}

test('hero commands accept current names and eids, default to the caller, and refuse stale names', async () => {
  let { ask, wrote } = await fixture()
  for (let player of ['matt', HERO, undefined]) {
    let selected = player === undefined ? {} : { player }
    let where = await ask('where', selected)
    assertEquals(where.status, 200)
    assertStringIncludes(await where.text(), HERO)
    assertEquals((await ask('damage', { ...selected, on: false })).status, 200)
    assertEquals(wrote.at(-1), {
      entity: { eid: HERO },
      damageable: { on: false },
    })
    assertEquals(
      (await ask('teleport', { ...selected, x: 50, z: 50 })).status,
      200,
    )
    assertEquals(comp(wrote.at(-1), 'teleport_request').player, HERO)
    assertEquals((await ask('gather', { ...selected, count: 2 })).status, 200)
    assertEquals(wrote.at(-1)?.directive, {
      player: HERO,
      goal: 'wood',
      count: 2,
    })
  }
  let inspect = await ask('inspect', {})
  assertEquals(inspect.status, 200)
  assertStringIncludes(await inspect.text(), HERO)
  for (let command of ['where', 'damage', 'teleport', 'gather']) {
    assertEquals(
      (await ask(command, { player: 'Old name', on: false, x: 50, z: 50 }))
        .status,
      404,
    )
    assertEquals(
      (await ask(command, { on: false, x: 50, z: 50 }, 'nobody')).status,
      404,
    )
  }
})

test('hero commands authorize the author when the store names their reference', async () => {
  let { ask, wrote } = await fixture(true)
  assertEquals(
    (await ask('where', { player: HERO }, 'person', 'editor')).status,
    200,
  )
  assertEquals((await ask('gather', { player: HERO })).status, 200)
  assertEquals(wrote.at(-1)?.directive, {
    player: HERO,
    goal: 'wood',
    count: 1,
  })
  for (let command of ['where', 'gather']) {
    assertEquals(
      (await ask(command, { player: OTHER }, 'person', 'editor')).status,
      403,
    )
  }
  assertEquals(wrote.length, 1)
})

test('hero commands refuse ambiguous names with each matching hero and retain authorization', async () => {
  let { g, ask, wrote } = await fixture()
  assertEquals(
    (await ask('where', { player: 'Yaks' }, 'person', 'editor')).status,
    403,
  )
  assertEquals((await ask('gather', { player: 'Yaks' })).status, 403)
  assertEquals(
    (await ask('damage', { player: 'Matt', on: false }, 'person', 'editor'))
      .status,
    403,
  )
  assertEquals(
    (await ask(
      'teleport',
      { player: 'Matt', x: 50, z: 50 },
      'person',
      'editor',
    )).status,
    403,
  )
  assertEquals(wrote, [])
  await g.apply([{
    entity: { eid: 'other-new' },
    look: { player: OTHER, name: 'Matt', at: 4 },
  }])
  for (let command of ['where', 'damage', 'teleport', 'gather', 'inspect']) {
    let response = await ask(command, {
      player: 'Matt',
      target: 'Matt',
      on: false,
      x: 50,
      z: 50,
    })
    assertEquals(response.status, 400)
    let text = await response.text()
    assertStringIncludes(text, HERO)
    assertStringIncludes(text, OTHER)
  }
  assertEquals(wrote, [])
})
