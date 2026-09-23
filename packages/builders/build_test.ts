import { assert, assertEquals, assertNotEquals } from '@std/assert'
import type { Bundle, Comp, Graph, ToolCtx } from '@yaks/graph'
import { edgeEid, link } from '@yaks/edge'
import { counter, ids, noon, shop, workshop } from './harness.ts'
import { type Desk, type Open, output } from './build.ts'
import { effects, watches } from './effects.ts'
import { runs } from './tools.ts'
import { content, key } from './key.ts'

let scribe: Desk = {
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
let sessions = async (g: Graph) => (await rows(g, '.session')).length
let outputs = (g: Graph) => rows(g, '.built')

// A workshop watching for builders, with the clock held at noon and the eids
// it mints counted, so what a build wrote can be named.
let building = (o: Partial<Open> = {}) =>
  shop({ desk: scribe, rest: '1h', now: noon, eid: counter(), ...o })

// The builder, in its own words.
let writeup = (floor?: string): Bundle => ({
  entity: { eid: ids.builder },
  builder: floor ? { floor } : {},
  doc: { title: 'Write up', body: 'Write up what is waiting.' },
})

// An input, and the link that makes it one.
let note = (eid: string, body: string): Bundle => ({
  entity: { eid },
  doc: { body },
})
let reads = (to: string) => link(ids.builder, 'reads', to)

// The floor moved back into the present: what brings a resting builder back.
let stir = (g: Graph) =>
  g.apply([{
    entity: { eid: ids.builder },
    builder: { floor: '2026-09-19T08:00:00.000Z' },
  }])

// The on-demand door, called the way the tool runner calls it.
let demand = async (
  g: Graph,
  args: Record<string, unknown>,
  o: Parameters<typeof runs>[1] = { desk: scribe },
) => {
  let ctx: ToolCtx = {
    graph: g,
    actor: null,
    read: (q) => g.read(q),
    args,
    call: 'c-1',
  }
  let [said] = await runs({ vocab: g.vocab }, o).builder_build([], ctx)
  return String(comp(said, 'content')?.body)
}

Deno.test('a builder whose floor has passed opens one session, in its own words', async () => {
  let { g } = await building()
  await g.apply([writeup()])
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
  let wearing = await one(g, edgeEid('new-1', 'references', ids.voice))
  assertEquals(comp(wearing, 'edge')?.to, ids.voice)
})

Deno.test('a build mints its output under its key, and rests the builder', async () => {
  let { g } = await building()
  await g.apply([writeup()])
  let [out] = await outputs(g)
  let k = key('Write up what is waiting.', ids.mind, [])
  assertEquals(out.entity.eid, output(ids.builder, k))
  assertEquals(comp(out, 'built'), {
    builder: ids.builder,
    key: k,
    model: ids.mind,
    session: 'new-1',
  })
  let rested = await one(g, ids.builder)
  assertEquals(comp(rested, 'builder')?.floor, '2026-09-19T13:00:00.000Z')
  assertEquals(comp(rested, 'claim'), undefined)
})

Deno.test('an unchanged key reuses the output and runs nothing', async () => {
  let { g } = await building()
  await g.apply([note('n-1', 'first'), writeup(), reads('n-1')])
  await stir(g)
  // what it reads was written again, to the same words
  await g.apply([note('n-1', 'first')])
  await stir(g)
  assertEquals(await sessions(g), 1)
  assertEquals((await outputs(g)).length, 1)
})

Deno.test('a changed input rebuilds from scratch into a new output', async () => {
  let { g } = await building()
  await g.apply([note('n-1', 'first'), writeup(), reads('n-1')])
  let [before] = await outputs(g)
  await g.apply([note('n-1', 'second')])
  await stir(g)
  assertEquals(await sessions(g), 2)
  let after = await outputs(g)
  assertEquals(after.length, 2)
  let fresh = after.find((b) => b.entity.eid != before.entity.eid)!
  assertNotEquals(comp(fresh, 'built')?.key, comp(before, 'built')?.key)
  // a fresh session, asked afresh: the old output is nowhere in what it reads
  let asked = (await rows(g, '.entry'))
    .filter((b) => comp(b, 'entry')?.session == comp(fresh, 'built')?.session)
  assertEquals(asked.length, 1)
  assertEquals(
    comp(asked[0], 'content')?.body,
    'Write up what is waiting.\n\nInputs:\n- n-1',
  )
  // the output built before is left as it was
  assertEquals(comp(await one(g, before.entity.eid), 'built'), {
    ...comp(before, 'built'),
  })
})

Deno.test('a changed instruction rebuilds too', async () => {
  let { g } = await building()
  await g.apply([writeup()])
  await g.apply([{
    entity: { eid: ids.builder },
    doc: { body: 'Write up only what is new.' },
  }])
  await stir(g)
  assertEquals((await outputs(g)).length, 2)
})

Deno.test('a builder never reads its own output', async () => {
  let { g } = await building()
  await g.apply([writeup()])
  let [out] = await outputs(g)
  // linked to what it built, and that output answered since
  await g.apply([
    reads(out.entity.eid),
    { entity: out.entity, doc: { body: 'All caught up.' } },
  ])
  await stir(g)
  assertEquals(await sessions(g), 1)
  assertEquals((await outputs(g)).length, 1)
})

Deno.test("another builder's output is an input like any other", async () => {
  let { g } = await building()
  await g.apply([writeup()])
  let [out] = await outputs(g)
  await g.apply([
    {
      entity: { eid: 'z-digest' },
      builder: {},
      doc: { body: 'Digest the write-up.' },
    },
    link('z-digest', 'reads', out.entity.eid),
  ])
  let asked = (await rows(g, '.entry')).map((b) => comp(b, 'content')?.body)
  assert(asked.includes(`Digest the write-up.\n\nInputs:\n- ${out.entity.eid}`))
})

Deno.test('two models on one builder build sibling outputs', async () => {
  let { g } = await building()
  await g.apply([writeup()])
  let said = await demand(g, { builder: ids.builder, model: ids.other })
  let built = (await outputs(g)).map((b) => comp(b, 'built')?.model)
  assertEquals(built.toSorted(), [ids.mind, ids.other].toSorted())
  assert(said.includes('building in'), said)
  // the same model asked again finds its output current
  let again = await demand(g, { builder: ids.builder, model: ids.other })
  assert(again.includes('built under this key already'), again)
  assertEquals(await sessions(g), 2)
})

Deno.test('on demand builds whatever the floor says', async () => {
  let { g } = await building()
  await g.apply([writeup('2026-09-19T18:00:00.000Z')])
  assertEquals(await sessions(g), 0)
  await demand(g, { builder: ids.builder })
  assertEquals(await sessions(g), 1)
})

Deno.test('on demand refuses a graph with no desk, and a non-builder', async () => {
  let { g } = await building()
  await g.apply([note('n-1', 'not a builder')])
  let refused = async (args: Record<string, unknown>, o = {}) => {
    try {
      await demand(g, args, o)
    } catch (err) {
      return (err as Error).message
    }
    return ''
  }
  assert((await refused({ builder: ids.builder })).includes('no desk'))
  assert(
    (await refused({ builder: 'n-1' }, { desk: scribe })).includes(
      'no builder',
    ),
  )
})

Deno.test("a build's answer becomes its output's body", async () => {
  let { g } = await building()
  await g.apply([writeup()])
  let answer = (seq: number, body: string): Bundle => ({
    entity: { eid: `a-${seq}` },
    entry: { session: 'new-1', seq },
    content: { body },
    output: { source: 'new-2' },
  })
  await g.apply([answer(2, 'Looking.')])
  await g.apply([answer(3, 'Nothing is waiting.')])
  let [out] = await outputs(g)
  assertEquals(comp(out, 'doc')?.body, 'Nothing is waiting.')
})

Deno.test('a builder still resting builds nothing', async () => {
  let { g } = await building()
  await g.apply([writeup('2026-09-19T18:00:00.000Z')])
  assertEquals(await sessions(g), 0)
})

Deno.test('a builder nobody wrote words for builds nothing', async () => {
  let { g } = await building()
  await g.apply([{ entity: { eid: ids.builder }, builder: {} }])
  assertEquals(await sessions(g), 0)
})

Deno.test('a wordless builder is asked what the config asks', async () => {
  let { g } = await building({ desk: { ...scribe, ask: 'Harvest the memos.' } })
  await g.apply([{ entity: { eid: ids.builder }, builder: {} }])
  assertEquals(
    comp((await rows(g, '.entry'))[0], 'content')?.body,
    'Harvest the memos.',
  )
})

Deno.test('a wake firing on a builder brings it back', async () => {
  let at = noon()
  let { g } = await building({ now: () => at })
  await g.apply([writeup('2026-09-19T13:00:00.000Z')])
  assertEquals(await sessions(g), 0)
  // the floor has since passed; the wake is what asks again
  at = '2026-09-19T14:00:00.000Z'
  await g.apply([{
    entity: { eid: ids.builder },
    wake: { every: '1h', at: '2026-09-19T15:00:00.000Z' },
    fired: { at },
  }])
  assertEquals(await sessions(g), 1)
})

Deno.test('a wake aimed at a builder rebuilds it when its key moved', async () => {
  let at = noon()
  let { g } = await building({ now: () => at })
  await g.apply([writeup('2026-09-19T13:00:00.000Z')])
  let ring = (when: string) => {
    at = when
    return g.apply([{
      entity: { eid: 'w-hourly' },
      wake: { target: ids.builder, every: '1h' },
      fired: { at },
    }])
  }
  await ring('2026-09-19T14:00:00.000Z')
  assertEquals(await sessions(g), 1)
  // resting until 15:00, and then nothing it reads has changed
  await ring('2026-09-19T16:00:00.000Z')
  assertEquals(await sessions(g), 1)
  // a new input makes a new key, which the next ring builds
  await g.apply([note('n-1', 'new'), reads('n-1')])
  await ring('2026-09-19T17:00:00.000Z')
  assertEquals(await sessions(g), 2)
})

Deno.test('a wake that fired on something else builds nothing', async () => {
  let { g } = await building()
  await g.apply([{
    entity: { eid: 'w-chores' },
    wake: { at: '2026-09-19T13:00:00.000Z', note: 'take the bins out' },
    fired: { at: noon() },
  }])
  assertEquals(await sessions(g), 0)
})

Deno.test('a desk this box cannot serve is telemetry, not a broken write', async () => {
  let { g, failed } = await building({ desk: { ...scribe, model: 'o-nobody' } })
  await g.apply([writeup()])
  assertEquals(await sessions(g), 0)
  assertEquals(failed.length, 1)
  assert(String((failed[0] as Error).message).includes('o-nobody'))
  // the builder that woke it landed all the same
  assertEquals(
    comp(await one(g, ids.builder), 'doc')?.body,
    'Write up what is waiting.',
  )
})

Deno.test('a key is the instruction, the model and each input, in any order', () => {
  let a = key('Sum up.', 'O-1', [['m-1', 'x'], ['m-2', 'y']])
  assertEquals(a, key('Sum up.', 'O-1', [['m-2', 'y'], ['m-1', 'x']]))
  assertNotEquals(a, key('Sum up!', 'O-1', [['m-1', 'x'], ['m-2', 'y']]))
  assertNotEquals(a, key('Sum up.', 'O-2', [['m-1', 'x'], ['m-2', 'y']]))
  assertNotEquals(a, key('Sum up.', 'O-1', [['m-1', 'x'], ['m-2', 'z']]))
  assertNotEquals(a, key('Sum up.', 'O-1', [['m-1', 'x']]))
})

Deno.test("content is what was written, not the server's stamps", () => {
  let hash = content(workshop())
  let said: Bundle = { entity: { eid: 'n-1' }, doc: { title: 'A', body: 'B' } }
  let stamped: Bundle = {
    entity: { eid: 'n-1', num: 7 },
    doc: { body: 'B', title: 'A' },
    created: { at: noon() },
    updated: { at: noon() },
  }
  assertEquals(hash(said), hash(stamped))
  assertNotEquals(hash(said), hash({ ...said, doc: { title: 'A', body: 'C' } }))
  // a tag with no properties is a fact, so it counts
  assertNotEquals(hash(said), hash({ ...said, reads: {} }))
})

Deno.test('the facet is the watch list, and nothing without a desk', async () => {
  let { vocab } = await building()
  assertEquals(effects({ vocab }, {}), [])
  assertEquals(effects({ vocab }), [])
  let said = effects({ vocab }, { desk: scribe, rest: '1h' })
  assertEquals(said.map((w) => w.comp), ['builder', 'fired', 'output'])
  assertEquals(said[0].sweep, { pending: '.builder' })
  assertEquals(Object.keys(said[0].changed ?? {}), ['floor'])
  assertEquals(Object.keys(said[1].changed ?? {}), ['at'])
  assert(said.every((w) => !!w.created && !!w.doc))
  assertEquals(
    watches({ desk: scribe, rest: '1h', vocab }).map((w) => [w.comp, w.doc]),
    said.map((w) => [w.comp, w.doc]),
  )
})

Deno.test('a rest this box cannot read builds nothing, and says so', async () => {
  let { vocab } = await building()
  let warned: unknown[] = []
  let warn = console.warn
  console.warn = (...said: unknown[]) => warned.push(said[0])
  try {
    assertEquals(effects({ vocab }, { desk: scribe, rest: 'whenever' }), [])
  } finally {
    console.warn = warn
  }
  assert(String(warned[0]).includes('is no rest'), String(warned[0]))
})
