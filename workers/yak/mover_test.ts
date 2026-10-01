// The store mover (mover.ts) through a Store's own doors: rows moved from the
// alarm after boot, a rehearsal that moves nothing, and a failing batch that
// leaves the store serving until fixed code arrives.
import { test } from '@yaks/testing'
import { assert, assertEquals, assertRejects, assertThrows } from '@std/assert'
import { type Bundle, type Comp, Stale, token } from '@yaks/graph'
import { pick } from '@yaks/vocab'
import { kernelDoc } from '@yaks/kernel/vocab'
import { BUILD_OF, buildOf, OUTPUT_OF, outputOf } from '@yaks/builders'
import { edgeEid } from '@yaks/edge'
import { keyed } from '@yaks/key'
import { doorOf } from './door.ts'
import { Store } from './graph.ts'
import { KERNEL, metaOf } from './meta.ts'
import type { Rehearsal, Rule, Standing } from './mover.ts'
import { dispatchMove, dispatchRule, RULES, step } from './mover.ts'
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
    declare: (doc: unknown) => post('/vocab', JSON.stringify(doc)),
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

// The Store already speaks dispatch; add the lifecycle marks from their home.
let dispatchStore = async () => {
  let s = await store(0, dispatchRule)
  await s.declare(pick(kernelDoc, ['admitted', 'waiting']))
  return s
}

let legacy = (state: string, eid = state): Bundle => ({
  entity: { eid },
  dispatch: { state, args: '{"prompt":"keep me","cwd":"/scratch"}', order: 7 },
  admitted: { at: '2026-09-01T00:00:00.000Z', by: 'actor', via: 'run' },
  waiting: { at: '2026-09-02T00:00:00.000Z', by: 'actor', via: 'run' },
  doc: { title: 'unrelated words' },
})

let states = ['queued', 'active', 'waiting', 'settled']

test('dispatch rehearsal rule converts all four states and keeps the envelope', async () => {
  assertEquals(dispatchRule.live, undefined)
  assertEquals(
    dispatchRule.find,
    '.dispatch.state=queued,active,waiting,settled&*',
  )
  let s = await dispatchStore()
  await s.apply([
    ...states.map((state) => legacy(state)),
    legacy('future'),
    { entity: { eid: 'already' }, dispatch: { args: 'unchanged', order: 0 } },
  ])
  let rows = await s.query(dispatchRule.find)
  assertEquals(rows.map((b) => b.entity.eid).sort(), [...states].sort())
  await s.apply(rows.flatMap(dispatchMove))
  for (let state of states) {
    let [row] = await s.query(`.eid=${state}&*`)
    let dispatch = row.dispatch as Comp | undefined
    assertEquals(dispatch?.state ?? null, null)
    assertEquals(!!row.admitted, state == 'active')
    assertEquals(!!row.waiting, state == 'waiting')
    let before = rows.find((b) => b.entity.eid == state)!
    assertEquals(row.doc, before.doc)
    if (state == 'active') assertEquals(row.admitted, before.admitted)
    if (state == 'waiting') assertEquals(row.waiting, before.waiting)
    if (state == 'settled') assertEquals(dispatch, undefined)
    else {
      assertEquals(dispatch?.args, (legacy(state).dispatch as Comp).args)
      assertEquals(dispatch?.order, 7)
    }
    assertEquals(dispatchMove(row), [])
  }
  assertEquals(await s.query(dispatchRule.find), [])
  let [future] = await s.query('.eid=future&*')
  assertEquals((future.dispatch as Comp).state, 'future')
  assertEquals(dispatchMove(future), [])
  assertEquals(dispatchMove({ entity: { eid: 'absent' } }), [])
  let [already] = await s.query('.eid=already&*')
  assertEquals((already.dispatch as Comp).args, 'unchanged')
  assertEquals((already.dispatch as Comp).order, 0)
  assertEquals(dispatchMove(already), [])
})

test('dispatch conversion creates missing marks without changing empty envelopes', async () => {
  let s = await dispatchStore()
  await s.apply(states.map((state) => ({
    entity: { eid: state },
    dispatch: { state, args: '', order: 0 },
  })))
  let rows = await s.query(dispatchRule.find)
  await s.apply(rows.flatMap(dispatchMove))
  for (let state of states) {
    let [row] = await s.query(`.eid=${state}&*`)
    assertEquals(!!row.admitted, state == 'active')
    assertEquals(!!row.waiting, state == 'waiting')
    if (state == 'settled') assertEquals(row.dispatch, undefined)
    else {
      let dispatch = row.dispatch as Comp
      assertEquals([dispatch.state, dispatch.args, dispatch.order], [
        null,
        '',
        0,
      ])
    }
  }
})

test('dispatch guards include absent envelope and mark properties', () => {
  let row: Bundle = { entity: { eid: 'bare' }, dispatch: { state: 'queued' } }
  assertEquals(dispatchMove(row), [{
    entity: row.entity,
    dispatch: { state: null },
    admitted: null,
    waiting: null,
    $was: {
      dispatch: { state: token('queued'), args: null, order: null },
      admitted: { at: null, by: null, via: null },
      waiting: { at: null, by: null, via: null },
    },
  }])
})

test('dispatch rehearsal rolls back and an alarm never activates it', async () => {
  let s = await dispatchStore()
  await s.apply(states.map((state) => legacy(state)))
  let before = await s.query('*')
  let [r] = await s.rehearse()
  assertEquals([r.mark, r.rows, r.moved, r.failed], [
    dispatchRule.mark,
    4,
    4,
    undefined,
  ])
  assertEquals(await s.query('*'), before)
  await s.alarm()
  assertEquals(await s.query('*'), before)
  let [said] = await s.moves()
  assertEquals([said.live, said.done], [false, undefined])
})

test('dispatch conversion refuses changes to the old state, envelope or marks', async () => {
  let s = await dispatchStore()
  let changes = {
    dispatch: { state: 'waiting', args: 'new input', order: 8 },
    admitted: { at: '2026-09-03T00:00:00.000Z', by: 'other', via: 'another' },
    waiting: { at: '2026-09-03T00:00:00.000Z', by: 'other', via: 'another' },
  }
  for (let [comp, props] of Object.entries(changes)) {
    for (let [prop, value] of Object.entries(props)) {
      let eid = `${comp}-${prop}`
      let other = `${eid}-other`
      await s.apply([legacy('settled', eid), legacy('queued', other)])
      let [row] = await s.query(`.eid=${eid}&*`)
      let [untouched] = await s.query(`.eid=${other}&*`)
      let patch = [...dispatchMove(untouched), ...dispatchMove(row)]
      await s.apply([{ entity: { eid }, [comp]: { [prop]: value } }])
      let changed = await s.query(`.eid=${eid}&*`)
      await assertRejects(() => s.apply(patch), Stale, `${comp}.${prop}`)
      assertEquals(await s.query(`.eid=${eid}&*`), changed)
      assertEquals(await s.query(`.eid=${other}&*`), [untouched])
    }
  }
  for (let mark of ['admitted', 'waiting']) {
    let eid = `new-${mark}`
    await s.apply([{ entity: { eid }, dispatch: { state: 'queued' } }])
    let [row] = await s.query(`.eid=${eid}&*`)
    let patch = dispatchMove(row)
    await s.apply([{
      entity: { eid },
      [mark]: { at: '2026-09-03T00:00:00.000Z' },
    }])
    let changed = await s.query(`.eid=${eid}&*`)
    await assertRejects(() => s.apply(patch), Stale, `${mark}.at`)
    assertEquals(await s.query(`.eid=${eid}&*`), changed)
  }
  // A writer after conversion can restore state: guards cannot stop that.
  // This is why the rule stays rehearsal-only until old writers are gone.
  await s.apply([legacy('active', 'old-writer')])
  let [row] = await s.query('.eid=old-writer&*')
  await s.apply(dispatchMove(row))
  await s.apply([{ entity: row.entity, dispatch: { state: 'queued' } }])
  let [written] = await s.query('.eid=old-writer&*')
  assertEquals((written.dispatch as Comp).state, 'queued')
  assertEquals(
    (await s.query(`${dispatchRule.find}&.eid=old-writer`)).length,
    1,
  )
  await s.apply(dispatchMove(written))
  let [converted] = await s.query('.eid=old-writer&*')
  assertEquals(converted.admitted, undefined)
  assertEquals((converted.dispatch as Comp).state ?? null, null)
})
