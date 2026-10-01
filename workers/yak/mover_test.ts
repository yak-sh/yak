// The store mover (mover.ts) through a Store's own doors: rows moved from the
// alarm after boot, a rehearsal that moves nothing, and a failing batch that
// leaves the store serving until fixed code arrives.
import { test } from '@yaks/testing'
import { assert, assertEquals, assertThrows } from '@std/assert'
import type { Bundle } from '@yaks/graph'
import { BUILD_OF, buildOf, OUTPUT_OF, outputOf } from '@yaks/builders'
import { edgeEid } from '@yaks/edge'
import { keyed } from '@yaks/key'
import { doorOf } from './door.ts'
import { Store } from './graph.ts'
import { KERNEL, metaOf } from './meta.ts'
import type { Rehearsal, Rule, Standing } from './mover.ts'
import { RULES, step } from './mover.ts'
import { state } from './testing.ts'

let NAME = 'ada/notes'

// An app whose rows say a word two ways, the way a rename leaves them.
let WORDS = JSON.stringify({
  $defs: {
    was: { properties: { word: { type: 'string' } } },
    now: { properties: { word: { type: 'string' } } },
  },
})

let rule = (o: Partial<Rule> = {}): Rule => ({
  mark: 'yak/store/now/1',
  find: '.was',
  move: (row) => [{
    entity: row.entity,
    was: null,
    now: { word: (row.was as { word: string }).word },
  }],
  live: 'apps',
  ...o,
})

// One app store holding `n` rows in the old shape, and the doors onto it.
let store = async (n: number, ...rules: Rule[]) => {
  let ctx = state()
  let o = new Store(ctx, {}, rules)
  let fetch = (r: Request) => o.fetch(r)
  let door = doorOf(fetch, NAME)
  let meta = metaOf(door)
  let post = async (path: string, body?: string) =>
    await (await door(path, { method: 'POST', body }, KERNEL)).json()
  await post('/vocab', WORDS)
  let rows = Array.from({ length: n }, (_, i) => ({
    entity: { eid: crypto.randomUUID() },
    was: { word: `w${i}` },
  }))
  for (let i = 0; i < n; i += 100) {
    await meta.apply(rows.slice(i, i + 100) as Bundle[], KERNEL)
  }
  return {
    wake: (...rules: Rule[]) => o = new Store(ctx, {}, rules),
    alarm: () => o.alarm(),
    query: (q: string) => meta.query(q),
    apply: (rows: Bundle[]) => meta.apply(rows, KERNEL),
    moves: async () => (await post('/move')).rules as Standing[],
    held: async () => (await post('/move')).alarm as string | null,
    rehearse: async () => (await post('/move?rehearse=1')).rules as Rehearsal[],
  }
}

let count = async (s: { query: (q: string) => Promise<Bundle[]> }, q: string) =>
  (await s.query(q)).length

test('a live rule moves every row from the alarm, and says it is done', async () => {
  let s = await store(250, rule())
  // Woken, a store owing rows says the alarm it will move them from.
  assert(Date.parse(String(await s.held())) <= Date.now())
  let [first] = await s.query('.was')
  for (let i = 0; i < 5 && (await s.moves())[0]?.done == null; i++) {
    await s.alarm()
  }
  let [said] = await s.moves()
  assertEquals([said.moved, !!said.done], [250, true])
  assertEquals(await count(s, '.was'), 0)
  assertEquals(await count(s, '.now'), 250)
  let [moved] = await s.query(`.entity.eid=${first.entity.eid}&.now`)
  assertEquals(moved.now, first.was)
})

test('a rehearsal says what a rule would move, and moves nothing', async () => {
  let s = await store(250, rule({ live: undefined }))
  let [r] = await s.rehearse()
  assertEquals([r.rows, r.moved, r.failed], [250, 250, undefined])
  await s.alarm()
  assertEquals(await count(s, '.was'), 250)
  let [said] = await s.moves()
  assertEquals([said.live, said.done], [false, undefined])
})

test('a failing batch unwinds, the store serves, and a fix finishes it', async () => {
  let broken = rule({
    move: (row) => {
      if ((row.was as { word: string }).word == 'w3') throw new Error('no')
      return rule().move(row)
    },
  })
  let s = await store(5, broken)
  assertEquals((await s.rehearse())[0].failed, 'no')
  await s.alarm()
  assertEquals((await s.moves())[0].failed, 'no')
  assertEquals(await count(s, '.was'), 5)
  s.wake(rule())
  await s.alarm()
  assertEquals(await count(s, '.now'), 5)
  assert((await s.moves())[0].done)
})

test('a rule reading words a store does not speak is done there', async () => {
  let s = await store(1, rule({ find: '.nowhere' }))
  assertEquals((await s.rehearse())[0].unspoken, 'nowhere')
  await s.alarm()
  let [said] = await s.moves()
  assertEquals([said.unspoken, said.moved, !!said.done], ['nowhere', 0, true])
})

let buildRule = RULES.find((r) => r.mark == 'yak/store/build_of/13')!
let outputRule = RULES.find((r) => r.mark == 'yak/store/output_of/14')!

test('the build and output rules key existing ordinary and link eids by tuple and slot', async () => {
  let build = 'existing-build'
  let edge = edgeEid(build, 'cites', 'existing-builder')
  let rows: Bundle[] = [
    { entity: { eid: 'existing-builder' }, builder: {} },
    {
      entity: { eid: build },
      build: { builder: 'existing-builder', match: '[]' },
    },
    { entity: { eid: 'existing-output' }, built: { build, slot: 'main' } },
    {
      entity: { eid: edge },
      edge: { from: build, to: 'existing-builder' },
      cites: {},
      built: { build, slot: 'citation' },
    },
  ]
  assertEquals(buildRule.move(rows[1]), [
    keyed(BUILD_OF, build, buildOf('existing-builder', '[]')),
  ])
  for (let [row, slot] of [[rows[2], 'main'], [rows[3], 'citation']] as const) {
    assertEquals(outputRule.move(row), [
      keyed(OUTPUT_OF, row.entity.eid, outputOf(build, slot)),
    ])
  }
  let s = await store(0, buildRule, outputRule)
  await s.apply(rows)
  let before = [await s.query('.build'), await s.query('.built')]
  let rehearsed = await s.rehearse()
  assertEquals(rehearsed.map((r) => [r.rows, r.moved, r.failed]), [
    [1, 1, undefined],
    [2, 2, undefined],
  ])
  await s.alarm()
  assertEquals([await s.query('.build'), await s.query('.built')], before)
  assertEquals(await count(s, '.key'), 0)
  assertEquals((await s.moves()).map((r) => [r.live, r.done]), [
    [false, undefined],
    [false, undefined],
  ])
})

test('the output rule refuses slotless links without applying a batch or skipping rehearsal rows', async () => {
  for (let slot of [undefined, '']) {
    let build = 'legacy-build'
    let eid = edgeEid(build, 'cites', 'legacy-builder')
    let row: Bundle = {
      entity: { eid },
      edge: { from: build, to: 'legacy-builder' },
      cites: {},
      built: { build, ...(slot === undefined ? {} : { slot }) },
    }
    let writes = 0
    assertThrows(
      () =>
        step(
          {
            read: () => [
              {
                entity: { eid: 'valid-output' },
                built: { build, slot: 'main' },
              },
              row,
            ],
            rows: () => [],
            apply: (patch) => {
              writes++
              return patch
            },
            tx: (body) => body(),
          },
          outputRule,
          null,
          50,
          '2026-10-01T00:00:00Z',
        ),
      Error,
      `${eid} needs slot recovery`,
    )
    assertEquals(writes, 0)
    let s = await store(0, outputRule)
    await s.apply([
      { entity: { eid: 'legacy-builder' }, builder: {} },
      {
        entity: { eid: build },
        build: { builder: 'legacy-builder', match: '[]' },
      },
      row,
    ])
    let before = await s.query('.built')
    let [r] = await s.rehearse()
    assertEquals([r.rows, r.moved], [1, 0])
    assert(r.failed?.includes(`${eid} needs slot recovery`))
    await s.alarm()
    assertEquals(await s.query('.built'), before)
    assertEquals(await count(s, '.key'), 0)
    assertEquals((await s.moves())[0].done, undefined)
  }
})

test('the key rules refuse invalid build references and builder match tuples', () => {
  for (let build of [undefined, '', 1]) {
    assertThrows(
      () =>
        outputRule.move({
          entity: { eid: 'bad-output' },
          built: { build, slot: 'main' },
        }),
      Error,
      'bad-output needs built.build recovery',
    )
  }
  for (let builder of [undefined, '', 1]) {
    assertThrows(
      () =>
        buildRule.move({
          entity: { eid: 'bad-build' },
          build: { builder, match: '[]' },
        }),
      Error,
      'bad-build needs build.builder recovery',
    )
  }
  for (let match of [undefined, '', 1, 'broken', '{}', 'null', '[1]', '[""]']) {
    assertThrows(
      () =>
        buildRule.move({
          entity: { eid: 'bad-build' },
          build: { builder: 'builder', match },
        }),
      Error,
      'bad-build needs build.match recovery',
    )
  }
  assertEquals(
    buildRule.move({
      entity: { eid: 'null-binding' },
      build: { builder: 'builder', match: '["entity",null]', variant: 'other' },
    }),
    [keyed(
      BUILD_OF,
      'null-binding',
      buildOf('builder', '["entity",null]', 'other'),
    )],
  )
})

test('the real key rules accept the same owner and refuse a different holder without writes', async () => {
  let build = 'held-build'
  let output = edgeEid(build, 'cites', 'held-builder')
  for (
    let [rule, kind, owner, value] of [
      [buildRule, BUILD_OF, build, buildOf('held-builder', '[]')],
      [outputRule, OUTPUT_OF, output, outputOf(build, 'citation')],
    ] as const
  ) {
    for (let holder of [owner, 'other-owner']) {
      let s = await store(0, rule)
      let key = keyed(kind, holder, value)
      await s.apply([
        { entity: { eid: 'held-builder' }, builder: {} },
        {
          entity: { eid: build },
          build: { builder: 'held-builder', match: '[]' },
        },
        {
          entity: { eid: output },
          edge: { from: build, to: 'held-builder' },
          cites: {},
          built: { build, slot: 'citation' },
        },
        { entity: { eid: 'other-owner' }, doc: { title: 'Other owner' } },
        key,
      ])
      let before = await s.query('.key')
      let [r] = await s.rehearse()
      assertEquals([r.rows, r.moved], [1, holder == owner ? 1 : 0])
      if (holder == owner) assertEquals(r.failed, undefined)
      else assert(r.failed?.includes(`is ${holder}'s`))
      assertEquals(await s.query('.key'), before)
      assertEquals((await s.moves())[0].done, undefined)
    }
  }
})
