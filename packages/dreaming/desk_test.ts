import { assert, assertEquals } from '@std/assert'
import type { Bundle, Comp, Graph } from '@yaks/graph'
import { edgeEid } from '@yaks/edge'
import { counter, ids, noon, notes } from './harness.ts'
import { type Open, watches } from './desk.ts'
import { effects } from './effects.ts'

let scribe = {
  provider: ids.house,
  model: ids.mind,
  effort: 'high',
  persona: ids.voice,
  actor: ids.voice,
}

let comp = (b: Bundle | undefined, name: string) =>
  b?.[name] as Comp | undefined

let rows = async (g: Graph, q: string) => (await g.read(q)) as Bundle[]
let one = async (g: Graph, eid: string) => (await rows(g, `.eid=${eid}`))[0]

// A notebook watching for dreams, with the clock held at noon and the eids it
// mints counted, so what a desk wrote can be named.
let dreaming = (o: Partial<Open> = {}) =>
  notes({ desk: scribe, rest: '1h', now: noon, eid: counter(), ...o })

// The standing intention, in its own words.
let intention = (floor?: string): Bundle => ({
  entity: { eid: ids.dream },
  dream: { scope: ids.work, ...(floor ? { floor } : {}) },
  doc: { title: 'Write up', body: 'Write up what is waiting.' },
})

Deno.test('a dream whose floor has passed opens one desk, in its own words', async () => {
  let { g } = await dreaming()
  await g.apply([intention()])
  let opened = await rows(g, '.session')
  assertEquals(opened.length, 1)
  assertEquals(opened[0].entity.eid, 'new-1')
  assertEquals(comp(opened[0], 'session')?.actor, ids.voice)
  let line = (await rows(g, '.entry'))[0]
  assertEquals(comp(line, 'entry'), { session: 'new-1', seq: 1 })
  assertEquals(comp(line, 'content')?.body, 'Write up what is waiting.')
  assertEquals(comp(line, 'using'), {
    provider: ids.house,
    model: ids.mind,
    effort: 'high',
  })
  // the voice it wears, said as an edge
  let wearing = await one(g, edgeEid('new-1', 'references', ids.voice))
  assertEquals(comp(wearing, 'edge')?.to, ids.voice)
})

Deno.test('the dream that opened it is locked, rested and counted', async () => {
  let { g } = await dreaming()
  await g.apply([intention()])
  let dreamed = await one(g, ids.dream)
  assertEquals(comp(dreamed, 'claim')?.session, 'new-1')
  assertEquals(comp(dreamed, 'dream')?.floor, '2026-09-19T13:00:00.000Z')
  assertEquals(comp(dreamed, 'recall'), {
    count: 1,
    first_at: noon(),
    last_at: noon(),
  })
  // what it is about is untouched by the rest
  assertEquals(comp(dreamed, 'dream')?.scope, ids.work)
})

Deno.test('a dream still resting opens nothing', async () => {
  let { g } = await dreaming()
  await g.apply([intention('2026-09-19T18:00:00.000Z')])
  assertEquals((await rows(g, '.session')).length, 0)
})

Deno.test('a dream with a desk already up opens no second one', async () => {
  let { g } = await dreaming()
  await g.apply([intention()])
  // its floor moved back into the present — the lock is what holds now
  await g.apply([{
    entity: { eid: ids.dream },
    dream: { floor: '2026-09-19T08:00:00.000Z' },
  }])
  assertEquals((await rows(g, '.session')).length, 1)
  assertEquals(comp(await one(g, ids.dream), 'recall')?.count, 1)
})

Deno.test('a dream nobody wrote words for opens nothing', async () => {
  let { g } = await dreaming()
  await g.apply([{ entity: { eid: ids.dream }, dream: { scope: ids.work } }])
  assertEquals((await rows(g, '.session')).length, 0)
})

Deno.test('a wordless dream is asked what the config asks', async () => {
  let { g } = await dreaming({ desk: { ...scribe, ask: 'Harvest the memos.' } })
  await g.apply([{ entity: { eid: ids.dream }, dream: { scope: ids.work } }])
  assertEquals(
    comp((await rows(g, '.entry'))[0], 'content')?.body,
    'Harvest the memos.',
  )
})

Deno.test('a wake firing on a dream brings it back', async () => {
  let { g } = await dreaming()
  await g.apply([intention('2026-09-19T18:00:00.000Z')])
  assertEquals((await rows(g, '.session')).length, 0)
  // the floor has since passed; the wake is what asks again
  await g.apply([{
    entity: { eid: ids.dream },
    dream: { floor: '2026-09-19T08:00:00.000Z' },
    wake: { every: '1h', at: '2026-09-19T13:00:00.000Z' },
    fired: { at: noon() },
  }])
  assertEquals((await rows(g, '.session')).length, 1)
})

Deno.test('a wake aimed at a dream brings that one back', async () => {
  let { g } = await dreaming()
  await g.apply([intention('2026-09-19T18:00:00.000Z')])
  await g.apply([{
    entity: { eid: ids.dream },
    dream: { floor: '2026-09-19T08:00:00.000Z' },
  }])
  await g.apply([{
    entity: { eid: 'w-hourly' },
    wake: { target: ids.dream, at: '2026-09-19T13:00:00.000Z' },
    fired: { at: noon() },
  }])
  assertEquals((await rows(g, '.session')).length, 1)
})

Deno.test('a wake that fired on something else opens nothing', async () => {
  let { g } = await dreaming()
  await g.apply([{
    entity: { eid: 'w-chores' },
    wake: { at: '2026-09-19T13:00:00.000Z', note: 'take the bins out' },
    fired: { at: noon() },
  }])
  assertEquals((await rows(g, '.session')).length, 0)
})

Deno.test('a desk this box cannot serve is telemetry, not a broken write', async () => {
  let { g, failed } = await dreaming({ desk: { ...scribe, model: 'o-nobody' } })
  await g.apply([intention()])
  assertEquals((await rows(g, '.session')).length, 0)
  assertEquals(failed.length, 1)
  assert(String((failed[0] as Error).message).includes('o-nobody'))
  // the dream that woke it landed all the same
  assertEquals(comp(await one(g, ids.dream), 'dream')?.scope, ids.work)
})

Deno.test('the facet is the watch list, and nothing without a desk', () => {
  assertEquals(effects(null, {}), [])
  assertEquals(effects(null), [])
  let said = effects(null, { desk: scribe, rest: '1h' })
  assertEquals(said.map((w) => w.comp), ['dream', 'fired'])
  assertEquals(said[0].sweep, { pending: '.dream' })
  assertEquals(Object.keys(said[0].changed ?? {}), ['floor'])
  assertEquals(Object.keys(said[1].changed ?? {}), ['at'])
  assert(said.every((w) => !!w.created && !!w.doc))
})

Deno.test('a rest this box cannot read opens no desk, and says so', () => {
  let warned: unknown[] = []
  let warn = console.warn
  console.warn = (...said: unknown[]) => warned.push(said[0])
  try {
    // Nothing composes a desk it would open on every stir — and nothing takes
    // the host down over it either.
    assertEquals(effects(null, { desk: scribe, rest: 'whenever' }), [])
  } finally {
    console.warn = warn
  }
  assert(String(warned[0]).includes('is no rest'), String(warned[0]))
})

Deno.test('the watch list is the same one the facet hands a host', () => {
  let o = { desk: scribe, rest: '1h' }
  assertEquals(
    watches(o).map((w) => [w.comp, w.doc]),
    effects(null, o).map((w) => [w.comp, w.doc]),
  )
})
