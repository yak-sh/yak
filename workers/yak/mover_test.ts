// The store mover (mover.ts) through a Store's own doors: rows moved from the
// alarm after boot, a rehearsal that moves nothing, and a failing batch that
// leaves the store serving until fixed code arrives.
import { test } from '@yaks/testing'
import { assert, assertEquals, assertRejects } from '@std/assert'
import { type Bundle, type Comp, Stale, token } from '@yaks/graph'
import { pick } from '@yaks/vocab'
import { kernelDoc } from '@yaks/kernel/vocab'
import { doorOf } from './door.ts'
import { Store } from './graph.ts'
import { KERNEL, metaOf } from './meta.ts'
import {
  dispatchMove,
  dispatchRule,
  doneEffectsRule,
  takeRule,
} from './mover.ts'
import { keyed } from '@yaks/key'
import { buildOf, inputKey } from '@yaks/builders'
import { toolEid } from '@yaks/tools'
import { deadMailInboxMove, deadMailInboxRule } from './migrate.ts'
import { type Rehearsal, type Rule, type Standing } from './mover.ts'
import { state } from './testing.ts'
import { driver } from '@yaks/durable-object'

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
    columns: (name: string) =>
      driver(ctx.storage).query({ t: 'pragma', name: 'table_info', arg: name })
        .map((c) => c.name),
    failDrop: () => {
      let exec = ctx.storage.sql.exec.bind(ctx.storage.sql)
      ctx.storage.sql.exec = (sql, ...args) => {
        if (/alter table.*drop column/i.test(sql)) {
          throw new Error('contraction failed')
        }
        return exec(sql, ...args)
      }
      return () => ctx.storage.sql.exec = exec
    },
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

test('builder take rehearsal preserves a store, then conversion moves with no calls', async () => {
  let s = await store(0, takeRule)
  let binding = {
    entities: ['source'],
    vars: { s: 'source', description: 'a turtle' },
  }
  await s.apply([
    { entity: { eid: toolEid('no-call') }, tool: { name: 'no-call' } },
    {
      entity: { eid: 'recipe' },
      builder: {
        query: '$s .doc.title=Source, doc.body=$description',
        to: toolEid('no-call'),
        immediate: true,
      },
      staged: {},
    },
    { entity: { eid: 'source' }, doc: { title: 'Source', body: 'a turtle' } },
    {
      entity: { eid: 'build' },
      build: {
        builder: 'recipe',
        call: 'call',
        key: 'kept-attempt',
        inputs: 'old-fingerprint',
        variant: 'main',
        match: '["source"]',
      },
    },
    {
      entity: { eid: 'call' },
      call: { to: toolEid('no-call'), source: 'build', args: { binding } },
      completed: {},
    },
    {
      entity: { eid: 'take' },
      built: {
        build: 'build',
        slot: 'kind',
        call: 'call',
        key: 'kept-attempt',
        inputs: 'old-fingerprint',
      },
      doc: { body: 'keep this design' },
    },
    keyed('output_of', 'take', 'build/kind'),
    keyed('build_of', 'build', buildOf('recipe', '["source"]')),
  ])
  // Activate a selected binding with its old paid attempt already recorded.
  await s.apply([{ entity: { eid: 'recipe' }, staged: null }])
  await s.apply([{
    entity: { eid: 'source' },
    was: { word: 'gameplay moved' },
  }])
  assertEquals(await count(s, '.call'), 1)
  let before = await s.query('*')
  let [report] = await s.rehearse()
  assertEquals([report.rows, report.moved, report.failed], [2, 2, undefined])
  assertEquals(await s.query('*'), before)
  await s.alarm()
  assertEquals(await s.query('*'), before)
  s.wake({ ...takeRule, live: 'apps' })
  await s.alarm()
  let [take] = await s.query('.entity.eid=take&*')
  assertEquals(take.doc, { title: null, body: 'keep this design' })
  assertEquals((take.built as Comp).inputs, inputKey(binding))
  assertEquals(
    (await s.query('.built.current=true')).map((r) => r.entity.eid),
    ['take'],
  )
  assertEquals(await count(s, '.call'), 1)
  assertEquals(await count(s, '.built'), 1)
  let [key] = await s.query('.output_of&*')
  assertEquals(key.key, { of: 'take', value: 'build/kind/call' })
  let after = await s.query('*')
  let [second] = await s.rehearse()
  assertEquals(second.failed, undefined)
  assertEquals(await s.query('*'), after)
})

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

let dispatchStore = async () => {
  let s = await store(0, dispatchRule)
  await s.declare(pick(kernelDoc, ['admitted', 'waiting']))
  await s.apply(['actor', 'run', 'other', 'another'].map((eid) => ({
    entity: { eid },
    doc: { title: eid },
  })))
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
    let [row] = await s.query(`.entity.eid=${state}&*`)
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
  let [future] = await s.query('.entity.eid=future&*')
  assertEquals((future.dispatch as Comp).state, 'future')
  assertEquals(dispatchMove(future), [])
  assertEquals(dispatchMove({ entity: { eid: 'absent' } }), [])
  let [already] = await s.query('.entity.eid=already&*')
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
  let applied = await s.apply(rows.flatMap(dispatchMove))
  for (let state of states) {
    if (state == 'settled') {
      assert(applied.find((b) => b.entity.eid == state)?.tombstone)
      assertEquals(await s.query('.entity.eid=settled&*'), [])
      continue
    }
    let [row] = await s.query(`.entity.eid=${state}&*`)
    assertEquals(!!row.admitted, state == 'active')
    assertEquals(!!row.waiting, state == 'waiting')
    let dispatch = row.dispatch as Comp
    assertEquals([dispatch.state, dispatch.args, dispatch.order], [
      null,
      '',
      0,
    ])
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
      let [row] = await s.query(`.entity.eid=${eid}&*`)
      let [untouched] = await s.query(`.entity.eid=${other}&*`)
      let patch = [...dispatchMove(untouched), ...dispatchMove(row)]
      await s.apply([{ entity: { eid }, [comp]: { [prop]: value } }])
      let changed = await s.query(`.entity.eid=${eid}&*`)
      await assertRejects(() => s.apply(patch), Stale, `${comp}.${prop}`)
      assertEquals(await s.query(`.entity.eid=${eid}&*`), changed)
      assertEquals(await s.query(`.entity.eid=${other}&*`), [untouched])
    }
  }
  for (let mark of ['admitted', 'waiting']) {
    let eid = `new-${mark}`
    await s.apply([{ entity: { eid }, dispatch: { state: 'queued' } }])
    let [row] = await s.query(`.entity.eid=${eid}&*`)
    let patch = dispatchMove(row)
    await s.apply([{
      entity: { eid },
      [mark]: { at: '2026-09-03T00:00:00.000Z' },
    }])
    let changed = await s.query(`.entity.eid=${eid}&*`)
    await assertRejects(() => s.apply(patch), Stale, `${mark}.at`)
    assertEquals(await s.query(`.entity.eid=${eid}&*`), changed)
  }
  // A writer after conversion can restore state: guards cannot stop that.
  // This is why the rule stays rehearsal-only until old writers are gone.
  await s.apply([legacy('active', 'old-writer')])
  let [row] = await s.query('.entity.eid=old-writer&*')
  await s.apply(dispatchMove(row))
  await s.apply([{ entity: row.entity, dispatch: { state: 'queued' } }])
  let [written] = await s.query('.entity.eid=old-writer&*')
  assertEquals((written.dispatch as Comp).state, 'queued')
  assertEquals(
    (await s.query(`${dispatchRule.find}&.entity.eid=old-writer`))
      .length,
    1,
  )
  await s.apply(dispatchMove(written))
  let [converted] = await s.query('.entity.eid=old-writer&*')
  assertEquals(converted.admitted, undefined)
  assertEquals((converted.dispatch as Comp).state ?? null, null)
})

test('source reads do not move or count sources, and rehearsal rolls back', async () => {
  let source = crypto.randomUUID()
  let reading = rule({
    live: undefined,
    move: (row, read) => {
      assert(read)
      let [from] = read(`.entity.eid=${source}&.now`)
      return [{
        entity: row.entity,
        was: null,
        now: from.now,
      }]
    },
  })
  let s = await store(51, reading)
  await s.apply([{ entity: { eid: source }, now: { word: 'source' } }])
  let before = await s.query(`.entity.eid=${source}`)
  let [r] = await s.rehearse()
  assertEquals([r.rows, r.moved, r.batches, r.failed], [51, 51, 2, undefined])
  assertEquals(await count(s, '.was'), 51)
  assertEquals(await count(s, '.now'), 1)
  assertEquals(await s.query(`.entity.eid=${source}`), before)
  s.wake({ ...reading, live: 'apps' })
  await s.alarm()
  let [said] = await s.moves()
  assertEquals([said.moved, !!said.done], [51, true])
  assertEquals(await count(s, '.was'), 0)
  assertEquals(await count(s, '.now.word=source'), 52)
  assertEquals(await s.query(`.entity.eid=${source}`), before)
})

let contracting = () =>
  rule({
    find: '.was.word',
    move: (
      row,
    ) => [{
      entity: row.entity,
      was: { word: null },
      now: { word: (row.was as Comp).word },
    }],
    drop: ['was.word'],
  })

test('mover contraction waits for the last value and rehearsal restores the column', async () => {
  let s = await store(300, contracting())
  let [rehearsed] = await s.rehearse()
  assertEquals([rehearsed.moved, rehearsed.failed], [300, undefined])
  assert(s.columns('was').includes('word'))
  assertEquals(await count(s, '.was.word'), 300)
  await s.alarm()
  assert(s.columns('was').includes('word'))
  assertEquals(await count(s, '.was.word'), 50)
  await s.alarm()
  assert(!s.columns('was').includes('word'))
  assertEquals(await count(s, '.now'), 300)
  assertEquals(await count(s, '.was'), 300)
  let [said] = await s.moves()
  assertEquals([said.moved, !!said.done], [300, true])
  s.wake(contracting())
  await s.alarm()
  assert(!s.columns('was').includes('word'))
  assertEquals((await s.moves())[0].moved, 300)
})

test('a refused contraction unwinds its data batch and retries after wake', async () => {
  let s = await store(1, contracting())
  let restore = s.failDrop()
  try {
    let [rehearsed] = await s.rehearse()
    assertEquals(rehearsed.failed, 'contraction failed')
    await s.alarm()
    assertEquals(await count(s, '.was.word'), 1)
    assertEquals(await count(s, '.now'), 0)
    assert(s.columns('was').includes('word'))
    assertEquals((await s.moves())[0].failed, 'contraction failed')
  } finally {
    restore()
  }
  s.wake(contracting())
  await s.alarm()
  assertEquals(await count(s, '.now'), 1)
  assert(!s.columns('was').includes('word'))
})

// Synthetic only: 141 matches is the owner's measured count, not a read of
// Vale. Near misses deliberately include work that could still be legitimate.
let deadMail = (eid: string, props: Comp = {}): Bundle => ({
  entity: { eid },
  effect: {
    handler: 'mail_inbox',
    target: 'archive-target',
    state: 'pending',
    kind: 'changed',
    comp: 'archived',
    attempts: 0,
    at: '2026-10-03T21:38:00.000Z',
    generation: 0,
    touched: ['archived'],
    ...props,
  },
})

let deadEid = (i: number) =>
  `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`

let deadMailStore = async () => {
  let s = await store(0, deadMailInboxRule)
  let dead = Array.from(
    { length: 141 },
    (_, i) => deadMail(deadEid(i)),
  )
  // A run carrying another component keeps it; only effect is removed.
  dead[0].doc = { title: 'preserve attached data' }
  let kept = [
    deadMail('other-handler', { handler: 'other' }),
    deadMail('done', { state: 'done' }),
    deadMail('failed', { state: 'failed' }),
    deadMail('created', { kind: 'created' }),
    deadMail('other-comp', { comp: 'comment' }),
    deadMail('attempted', { attempts: 1 }),
    deadMail('claimed', { lease_owner: 'worker' }),
    deadMail('claim-token', { lease_token: 'claim' }),
    deadMail('claim-expiry', { lease_expiry: '2026-10-04T20:00:00.000Z' }),
    deadMail('new', { at: '2026-10-04T19:07:36.001Z' }),
    deadMail('cutoff', { at: '2026-10-04T19:07:36.000Z' }),
    deadMail('no-time', { at: null }),
    deadMail('no-attempts', { attempts: null }),
    {
      entity: { eid: 'archive-target' },
      doc: { title: 'Do not touch the archived target' },
      archived: {},
    },
    { entity: { eid: 'other-target' }, doc: { title: 'Do not touch' } },
  ]
  for (let rows of [kept, dead.slice(0, 100), dead.slice(100)]) {
    await s.apply(rows)
  }
  return s
}

let remainingEffects = async (s: Awaited<ReturnType<typeof store>>) =>
  await count(s, '.effect')

test('dead mail rehearsal rolls back 141 rows before explicit activation', async () => {
  let s = await deadMailStore()
  let before = await s.query('*')
  let [r] = await s.rehearse()
  assertEquals([r.rows, r.moved, r.batches, r.failed], [141, 141, 3, undefined])
  assertEquals(await s.query('*'), before)
  assertEquals(await remainingEffects(s), 154)
  assertEquals(await count(s, '.effect.state=pending'), 152)
  assertEquals((await s.moves())[0].live, true)
})

test('synthetic cleanup removes 141 dead runs only and a second pass moves zero', async () => {
  let s = await deadMailStore()
  let candidates = await s.query(deadMailInboxRule.find)
  assertEquals(candidates.length, 141)
  let ids = new Set(candidates.map((b) => b.entity.eid))
  let before = (await s.query('*')).filter((b) => !ids.has(b.entity.eid))
  let preserved = new Set(before.map((b) => b.entity.eid))
  let [attached] = await s.query(`.entity.eid=${deadEid(0)}&*`)
  // Activation is exercised in this synthetic Store only; no hosted mover
  // door is invoked. The owner invokes the live mover after deployment.
  s.wake({ ...deadMailInboxRule, live: 'apps' })
  await s.alarm()
  assertEquals(await s.query(deadMailInboxRule.find), [])
  assertEquals(await remainingEffects(s), 13)
  assertEquals(await count(s, '.effect.state=pending'), 11)
  assertEquals(
    (await s.query('*')).filter((b) => preserved.has(b.entity.eid)),
    before,
  )
  let [after] = await s.query(`.entity.eid=${deadEid(0)}&*`)
  assertEquals(after.doc, attached.doc)
  assertEquals(after.effect, undefined)
  assertEquals([(await s.moves())[0].moved, !!(await s.moves())[0].done], [
    141,
    true,
  ])
  let once = await s.query('*')
  assertEquals((await s.rehearse())[0].rows, 0)
  assertEquals((await s.rehearse())[0].moved, 0)
  await s.alarm()
  assertEquals(await s.query('*'), once)
})

test('dead mail cleanup refuses a claim or changed selection after reading', async () => {
  let s = await store(0, deadMailInboxRule)
  await s.apply([{
    entity: { eid: 'archive-target' },
    doc: { title: 'Target' },
  }])
  for (
    let [prop, value] of Object.entries({
      handler: 'other',
      state: 'done',
      kind: 'created',
      comp: 'comment',
      at: '2026-10-04T19:07:36.001Z',
      attempts: 1,
      lease_owner: 'worker',
      lease_token: 'claim',
      lease_expiry: '2026-10-04T20:00:00.000Z',
    })
  ) {
    let eid = `race-${prop}`
    await s.apply([deadMail(eid), deadMail('batch-peer')])
    let rows = await s.query(deadMailInboxRule.find)
    let patch = rows.flatMap(deadMailInboxMove)
    await s.apply([{ entity: { eid }, effect: { [prop]: value } }])
    let before = await s.query('*')
    await assertRejects(() => s.apply(patch), Stale, `effect.${prop}`)
    assertEquals(await s.query('*'), before)
  }
  assertEquals(deadMailInboxMove({ entity: { eid: 'absent' } }), [])
  assertEquals(deadMailInboxMove(deadMail('new', { attempts: 1 })), [])
})

// Rehearsal-only until the owner has reviewed the all-store report.
test('legacy done effect cleanup rehearses without moving human data or failures', async () => {
  let s = await store(0, doneEffectsRule)
  await s.apply([
    { entity: { eid: 'done' }, effect: { state: 'done' } },
    {
      entity: { eid: 'human' },
      effect: { state: 'done' },
      was: { word: 'keep this' },
    },
    {
      entity: { eid: 'failed' },
      effect: { state: 'failed', error: 'keep failure' },
    },
    { entity: { eid: 'pending' }, effect: { state: 'pending' } },
  ])
  let before = await s.query('.effect&*')
  let [report] = await s.rehearse()
  assertEquals(report.rows, 2)
  assertEquals(report.failed, undefined)
  assertEquals(await s.query('.effect&*'), before)
  s.wake({ ...doneEffectsRule, live: 'apps' })
  for (let i = 0; i < 5 && (await s.query('.effect.state=done')).length; i++) {
    await s.alarm()
  }
  assertEquals(await s.query('.effect.state=done'), [])
  assertEquals((await s.query('.was'))[0].was, { word: 'keep this' })
  assertEquals(
    ((await s.query('.effect.state=failed'))[0].effect as Comp)?.error,
    'keep failure',
  )
  assertEquals((await s.query('.effect.state=pending')).length, 1)
})
