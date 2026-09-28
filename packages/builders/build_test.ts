import {
  assert,
  assertEquals,
  assertNotEquals,
  assertThrows,
} from '@std/assert'
import type { Bundle, Comp, Graph } from '@yaks/graph'
import { edgeEid } from '@yaks/edge'
import { status } from '@yaks/kernel'
import { effectsIn } from '@yaks/vocab'
import { counter, ids, noon, shop, workshop } from './testing.ts'
import { type Desk, type Open, output, run } from './build.ts'
import { effects, watches } from './effects.ts'
import { runs } from './tools.ts'
import { content, key } from './key.ts'
import { parse } from './answer.ts'

let scribe: Desk = {
  provider: ids.house,
  model: ids.mind,
  effort: 'high',
  persona: ids.voice,
  actor: ids.voice,
}
let comp = (b: Bundle | undefined, name: string) =>
  b?.[name] as Comp | undefined
let rows = async (g: Graph, q: string) => (await g.read(`${q}&*`)) as Bundle[]
let one = async (g: Graph, eid: string) => (await rows(g, `.eid=${eid}`))[0]
let sessions = async (g: Graph) => (await rows(g, '.session')).length
let outputs = (g: Graph) => rows(g, '.built')
let building = (o: Partial<Open> = {}) =>
  shop({ desk: scribe, rest: '1h', now: noon, eid: counter(), ...o })
let writeup = (floor?: string, query?: string): Bundle => ({
  entity: { eid: ids.builder },
  builder: { ...(floor ? { floor } : {}), ...(query ? { query } : {}) },
  doc: { title: 'Write up', body: 'Write up what is waiting.' },
})
let immediate = (floor?: string, query?: string): Bundle => {
  let b = writeup(floor, query)
  return {
    ...b,
    builder: {
      ...(floor ? { floor } : {}),
      ...(query ? { query } : {}),
      immediate: true,
    },
  }
}
let note = (eid: string, body: string): Bundle => ({
  entity: { eid },
  doc: { title: 'Source', body },
})
let stir = (g: Graph, eid = ids.builder) =>
  g.apply([{
    entity: { eid },
    builder: { floor: '2026-09-19T08:00:00.000Z' },
  }])
let demand = async (
  g: Graph,
  args: Record<string, unknown>,
  o: Parameters<typeof runs>[1] = { desk: scribe },
) => {
  let [said] = await runs({ vocab: g.vocab }, o).builder_build(
    { entity: { eid: 'c-1' }, call: { args } },
    g,
  )
  return String(comp(said, 'content')?.body)
}
let spec = (
  slot: string,
  body: string,
  inputs: string[] = [],
  more: Record<string, unknown> = {},
) => ({ slot, inputs, components: { doc: { body }, ...more } })
let reply = async (
  g: Graph,
  builder: string,
  outputs: unknown[],
  variant = 'main',
) => {
  let session = String(
    comp(await one(g, run(builder, variant)), 'build')?.session,
  )
  await g.apply([{
    entity: { eid: crypto.randomUUID() },
    entry: { session, seq: 2 },
    content: { body: JSON.stringify({ outputs }) },
    output: { source: 'new-2' },
  }])
}

Deno.test('a due builder opens one session asking for named graph outputs', async () => {
  let { g } = await building()
  await g.apply([writeup()])
  assertEquals(await sessions(g), 1)
  let line = (await rows(g, '.entry'))[0]
  assertEquals(comp(line, 'entry'), { session: 'new-1', seq: 1 })
  assert(String(comp(line, 'content')?.body).includes('"outputs"'))
  assertEquals(comp(line, 'using'), {
    provider: ids.house,
    model: ids.mind,
    effort: 'high',
  })
  assertEquals((await outputs(g)).length, 0)
})

Deno.test('one answer writes many stable output entities with their own components', async () => {
  let villager = {
    $defs: {
      villager: {
        component: true,
        type: 'object',
        properties: { role: { type: 'string' } },
      },
    },
  }
  let { g } = await shop({
    desk: scribe,
    now: noon,
    eid: counter(),
  }, [villager])
  await g.apply([writeup()])
  await reply(g, ids.builder, [
    spec('Ada', 'Keeps the forge.', [], { villager: { role: 'smith' } }),
    spec('Ben', 'Runs the inn.', [], { villager: { role: 'innkeeper' } }),
  ])
  assertEquals((await outputs(g)).length, 2)
  assertEquals(
    comp(await one(g, output(ids.builder, 'Ada')), 'villager')?.role,
    'smith',
  )
  assertEquals(
    comp(await one(g, output(ids.builder, 'Ben')), 'doc')?.body,
    'Runs the inn.',
  )
  let ada = output(ids.builder, 'Ada')
  await g.apply([{
    entity: { eid: ids.builder },
    doc: { body: 'Revise the town.' },
  }])
  await stir(g)
  await reply(g, ids.builder, [spec('Ada', 'Now runs the foundry.', [], {
    villager: { role: 'founder' },
  })])
  assertEquals((await outputs(g)).length, 2)
  assertEquals(comp(await one(g, ada), 'villager')?.role, 'founder')
  assertEquals(
    comp(await one(g, output(ids.builder, 'Ben')), 'doc')?.body,
    'Runs the inn.',
  )
})

Deno.test('the same key opens nothing, and a changed input changes the run key', async () => {
  let { g } = await building()
  await g.apply([note('n-1', 'first'), writeup(undefined, '.doc.title=Source')])
  let before = comp(await one(g, run(ids.builder)), 'build')?.key
  await stir(g)
  await g.apply([note('n-1', 'first')])
  await stir(g)
  assertEquals(await sessions(g), 1)
  await g.apply([note('n-1', 'second')])
  await stir(g)
  assertEquals(await sessions(g), 2)
  assertNotEquals(comp(await one(g, run(ids.builder)), 'build')?.key, before)
})

Deno.test('immediate builders respond to new, changed and removed query matches', async () => {
  let { g, failed } = await building()
  let floor = '2026-09-19T13:00:00.000Z'
  await g.apply([immediate(floor, '.doc.title=Source')])
  assertEquals(await sessions(g), 0)

  await g.apply([note('n-1', 'first')])
  assertEquals(await sessions(g), 1)
  await g.apply([note('n-1', 'first')])
  await g.apply([{ entity: { eid: 'unrelated' }, doc: { title: 'Other' } }])
  assertEquals(await sessions(g), 1)

  await g.apply([note('n-1', 'second')])
  assertEquals(await sessions(g), 2)
  await g.apply([{ entity: { eid: 'n-1' }, doc: { title: 'Other' } }])
  assertEquals(await sessions(g), 3)
  assertEquals(failed, [])
})

Deno.test('without immediate, an input change waits for the scheduled check', async () => {
  let { g } = await building()
  await g.apply([note('n-1', 'first'), writeup(undefined, '.doc.title=Source')])
  await g.apply([note('n-1', 'second')])
  assertEquals(await sessions(g), 1)
  await stir(g)
  assertEquals(await sessions(g), 2)
})

Deno.test('a new query match changes the key, while own outputs do not', async () => {
  let { g } = await building()
  await g.apply([note('n-1', 'first'), writeup(undefined, '.doc.title=Source')])
  let before = comp(await one(g, run(ids.builder)), 'build')?.key
  await g.apply([note('n-2', 'second')])
  await stir(g)
  assertNotEquals(comp(await one(g, run(ids.builder)), 'build')?.key, before)

  await g.apply([{
    entity: { eid: ids.builder },
    builder: { query: '.built' },
  }])
  await stir(g)
  await reply(g, ids.builder, [spec('story', 'Own output.')])
  let after = comp(await one(g, run(ids.builder)), 'build')?.key
  await stir(g)
  assertEquals(comp(await one(g, run(ids.builder)), 'build')?.key, after)
})

Deno.test('each output cites only its declared selected inputs', async () => {
  let { g, vocab } = await building()
  await g.apply([
    note('n-1', 'first'),
    note('n-2', 'second'),
    writeup(undefined, '.doc.title=Source'),
  ])
  await reply(g, ids.builder, [
    spec('one', 'Only the first.', ['n-1']),
    spec('two', 'Both.', ['n-1', 'n-2']),
  ])
  let cites = (await rows(g, '.cites')).map((b) => [
    comp(b, 'edge')?.from,
    comp(b, 'edge')?.to,
  ])
  assertEquals(cites.length, 3)
  assert(
    cites.some(([from, to]) =>
      from == output(ids.builder, 'one') && to == 'n-1'
    ),
  )
  assert(
    !cites.some(([from, to]) =>
      from == output(ids.builder, 'one') && to == 'n-2'
    ),
  )
  let citation = edgeEid(output(ids.builder, 'one'), 'cites', 'n-1')
  let source = async () =>
    (await rows(g, '.doc.title=Source'))
      .find((b) => b.entity.eid == 'n-1')!
  assertEquals(status(await one(g, citation), await source(), vocab), {
    state: 'current',
  })
  await g.apply([note('n-1', 'changed')])
  assertEquals(status(await one(g, citation), await source(), vocab), {
    state: 'moved',
  })
  await stir(g)
  await reply(g, ids.builder, [spec('one', 'Revised.', ['n-1'])])
  assertEquals(status(await one(g, citation), await source(), vocab), {
    state: 'current',
  })
})

Deno.test('an output drops and can regain a citation after a query match changes', async () => {
  let { g } = await building()
  await g.apply([note('n-1', 'first'), writeup(undefined, '.doc.title=Source')])
  await reply(g, ids.builder, [spec('report', 'First.', ['n-1'])])
  let cited = async () =>
    (await rows(g, '.cites'))
      .map((b) => comp(b, 'edge')?.to)
  assertEquals(await cited(), ['n-1'])
  await g.apply([{
    entity: { eid: ids.builder },
    builder: { query: '.doc.title=Other' },
  }, { entity: { eid: 'n-3' }, doc: { title: 'Other', body: 'third' } }])
  await stir(g)
  await reply(g, ids.builder, [spec('report', 'Third.', ['n-3'])])
  assertEquals(await cited(), ['n-3'])
  await g.apply([{
    entity: { eid: ids.builder },
    builder: { query: '.doc.title=Source' },
  }])
  await stir(g)
  await reply(g, ids.builder, [spec('report', 'First again.', ['n-1'])])
  assertEquals(await cited(), ['n-1'])
})

Deno.test('an upstream named output makes a downstream builder eligible', async () => {
  let { g, vocab } = await building()
  await g.apply([note('n-1', 'first'), writeup(undefined, '.doc.title=Source')])
  await reply(g, ids.builder, [spec('Ada', 'First story.', ['n-1'])])
  let upstream = output(ids.builder, 'Ada')
  await g.apply([{
    entity: { eid: 'z-digest' },
    builder: { query: `.eid=${upstream}` },
    doc: { body: 'Digest the story.' },
  }])
  await reply(g, 'z-digest', [spec('guide', 'First guide.', [upstream])])
  let downstream = output('z-digest', 'guide')
  let citation = edgeEid(downstream, 'cites', upstream)
  let before = comp(await one(g, run('z-digest')), 'build')?.key
  await g.apply([note('n-1', 'second')])
  await stir(g)
  await reply(g, ids.builder, [spec('Ada', 'Second story.', ['n-1'])])
  assertEquals(status(await one(g, citation), await one(g, upstream), vocab), {
    state: 'moved',
  })
  await stir(g, 'z-digest')
  assertNotEquals(comp(await one(g, run('z-digest')), 'build')?.key, before)
  await reply(g, 'z-digest', [spec('guide', 'Second guide.', [upstream])])
  assertEquals((await outputs(g)).length, 2)
  assertEquals(status(await one(g, citation), await one(g, upstream), vocab), {
    state: 'current',
  })
})

Deno.test('a changed cited output immediately starts its downstream builder', async () => {
  let { g, vocab, fx, failed } = await building()
  await g.apply([note('n-1', 'first'), writeup(undefined, '.doc.title=Source')])
  await reply(g, ids.builder, [spec('Ada', 'First story.', ['n-1'])])
  let upstream = output(ids.builder, 'Ada')
  await g.apply([{
    entity: { eid: 'z-digest' },
    builder: { query: `.eid=${upstream}`, immediate: true },
    doc: { body: 'Digest the story.' },
  }])
  await reply(g, 'z-digest', [spec('guide', 'First guide.', [upstream])])
  let citation = edgeEid(output('z-digest', 'guide'), 'cites', upstream)
  let before = comp(await one(g, run('z-digest')), 'build')?.key
  let starts = 0
  fx.created('using', () => {
    starts++
  })

  await g.apply([note('n-1', 'second')])
  await stir(g)
  await reply(g, ids.builder, [spec('Ada', 'Second story.', ['n-1'])])

  assertEquals(status(await one(g, citation), await one(g, upstream), vocab), {
    state: 'moved',
  })
  assertNotEquals(comp(await one(g, run('z-digest')), 'build')?.key, before)
  assertEquals(starts, 2)
  assertEquals(failed, [])
})

Deno.test('shadow runs write sibling outputs and downstream queries ignore them', async () => {
  let { g } = await building()
  await g.apply([writeup()])
  await reply(g, ids.builder, [spec('story', 'Primary.')])
  let started = await demand(g, { builder: ids.builder, model: ids.other })
  assert(started.includes('building in'), started)
  let shadow = (await rows(g, '.build')).find((b) =>
    comp(b, 'build')?.variant != 'main'
  )!
  let variant = String(comp(shadow, 'build')?.variant)
  await reply(g, ids.builder, [spec('story', 'Alternate.')], variant)
  assertEquals((await outputs(g)).length, 2)
  await g.apply([{
    entity: { eid: 'z-digest' },
    builder: { query: '.built' },
    doc: { body: 'Digest.' },
  }])
  await reply(g, 'z-digest', [
    spec('guide', 'Only primary.', [output(ids.builder, 'story')]),
  ])
  let citations = (await rows(g, '.cites'))
    .filter((b) => comp(b, 'edge')?.from == output('z-digest', 'guide'))
  assertEquals(citations.map((b) => comp(b, 'edge')?.to), [
    output(ids.builder, 'story'),
  ])
  assertNotEquals(
    output(ids.builder, 'story'),
    output(ids.builder, 'story', variant),
  )
})

Deno.test('an alternate prompt has its own stable run', async () => {
  let { g } = await building()
  await g.apply([writeup()])
  let first = await demand(g, {
    builder: ids.builder,
    prompt: 'Say it briefly.',
  })
  assert(first.includes('building in'), first)
  let again = await demand(g, {
    builder: ids.builder,
    prompt: 'Say it briefly.',
  })
  assert(again.includes('built under this key already'), again)
  assertEquals((await rows(g, '.build')).length, 2)
  assertEquals(await sessions(g), 2)
})

Deno.test('on demand builds past the floor and refuses an unconfigured desk', async () => {
  let { g } = await building()
  await g.apply([writeup('2026-09-19T18:00:00.000Z')])
  assertEquals(await sessions(g), 0)
  await demand(g, { builder: ids.builder })
  assertEquals(await sessions(g), 1)
  assertEquals(comp(await one(g, run(ids.builder)), 'build')?.variant, 'main')
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

Deno.test('a stale session answer cannot replace a newer run', async () => {
  let { g } = await building()
  await g.apply([writeup()])
  await g.apply([{
    entity: { eid: ids.builder },
    doc: { body: 'Second instruction.' },
  }])
  await stir(g)
  await g.apply([{
    entity: { eid: 'old-answer' },
    entry: { session: 'new-1', seq: 2 },
    content: { body: JSON.stringify({ outputs: [spec('old', 'Obsolete.')] }) },
    output: { source: 'new-2' },
  }])
  assertEquals((await outputs(g)).length, 0)
  await reply(g, ids.builder, [spec('new', 'Current.')])
  assertEquals((await outputs(g)).length, 1)
})

Deno.test('a malformed answer reports and leaves the key retryable', async () => {
  let { g, failed } = await building()
  await g.apply([writeup()])
  await g.apply([{
    entity: { eid: 'bad-answer' },
    entry: { session: 'new-1', seq: 2 },
    content: { body: '{not json' },
    output: { source: 'new-2' },
  }])
  assertEquals(failed.length, 1)
  assert(String((failed[0] as Error).message).includes('JSON object'))
  assertEquals(comp(await one(g, run(ids.builder)), 'build')?.key, null)
  await demand(g, { builder: ids.builder })
  assertEquals(await sessions(g), 2)
})

Deno.test('an answer cannot cite unselected inputs or write server fields', () => {
  let vocab = workshop()
  let body = (outputs: unknown[]) => JSON.stringify({ outputs })
  assertThrows(() =>
    parse(body([spec('one', 'A', ['not-selected'])]), [], vocab)
  )
  assertThrows(() =>
    parse(
      body([
        spec('one', 'A'),
        spec('one', 'B'),
      ]),
      [],
      vocab,
    )
  )
  assertThrows(() =>
    parse(
      body([spec('one', 'A', [], {
        created: { at: noon() },
      })]),
      [],
      vocab,
    )
  )
  assertThrows(() =>
    parse(
      body([spec('one', 'A', [], {
        built: { key: 'chosen by model' },
      })]),
      [],
      vocab,
    )
  )
})

Deno.test('a builder still resting or without instruction opens nothing', async () => {
  let { g } = await building()
  await g.apply([writeup('2026-09-19T18:00:00.000Z')])
  assertEquals(await sessions(g), 0)
  await g.apply([{ entity: { eid: 'z-empty' }, builder: {} }])
  assertEquals(await sessions(g), 0)
})

Deno.test('a wordless builder uses the configured instruction', async () => {
  let { g } = await building({ desk: { ...scribe, ask: 'Harvest the memos.' } })
  await g.apply([{ entity: { eid: ids.builder }, builder: {} }])
  assert(
    String(comp((await rows(g, '.entry'))[0], 'content')?.body)
      .startsWith('Harvest the memos.'),
  )
})

Deno.test('a wake firing on a builder brings it back', async () => {
  let at = noon()
  let { g } = await building({ now: () => at })
  await g.apply([writeup('2026-09-19T13:00:00.000Z')])
  at = '2026-09-19T14:00:00.000Z'
  await g.apply([{
    entity: { eid: ids.builder },
    wake: { every: '1h', at: '2026-09-19T15:00:00.000Z' },
    fired: { at },
  }])
  assertEquals(await sessions(g), 1)
})

Deno.test('a wake aimed at a builder checks its changed query key', async () => {
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
  await ring('2026-09-19T16:00:00.000Z')
  assertEquals(await sessions(g), 1)
  await g.apply([note('n-1', 'new'), {
    entity: { eid: ids.builder },
    builder: { query: '.doc.title=Source' },
  }])
  await ring('2026-09-19T17:00:00.000Z')
  assertEquals(await sessions(g), 2)
})

Deno.test('an unrelated wake starts no builder', async () => {
  let { g } = await building()
  await g.apply([{
    entity: { eid: 'w-chores' },
    wake: { at: '2026-09-19T13:00:00.000Z', note: 'take the bins out' },
    fired: { at: noon() },
  }])
  assertEquals(await sessions(g), 0)
})

Deno.test('a desk this box cannot serve reports without breaking the write', async () => {
  let { g, failed } = await building({ desk: { ...scribe, model: 'o-nobody' } })
  await g.apply([writeup()])
  assertEquals(await sessions(g), 0)
  assertEquals(failed.length, 1)
  assert(String((failed[0] as Error).message).includes('o-nobody'))
})

Deno.test('a key is the instruction, model and every selected input', () => {
  let a = key('Sum up.', 'O-1', [['m-1', 'x'], ['m-2', 'y']])
  assertEquals(a, key('Sum up.', 'O-1', [['m-2', 'y'], ['m-1', 'x']]))
  assertNotEquals(a, key('Sum up!', 'O-1', [['m-1', 'x'], ['m-2', 'y']]))
  assertNotEquals(a, key('Sum up.', 'O-2', [['m-1', 'x'], ['m-2', 'y']]))
  assertNotEquals(a, key('Sum up.', 'O-1', [['m-1', 'x'], ['m-2', 'z']]))
  assertNotEquals(a, key('Sum up.', 'O-1', [['m-1', 'x']]))
})

Deno.test('content is client-written properties, not server stamps', () => {
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
  assertNotEquals(hash(said), hash({ ...said, builder: { query: '.doc' } }))
})

Deno.test('the facet needs a desk and refuses an unreadable rest', async () => {
  let { vocab } = await building()
  assertEquals(effects({ vocab }, {}), {})
  let declared = effectsIn(vocab.docs).map((e) => e.name)
  assert(
    Object.keys(effects({ vocab }, { desk: scribe, rest: '1h' }))
      .every((n) => declared.includes(n)),
  )
  assertEquals(
    Object.keys(watches({ desk: scribe, rest: '1h', vocab })),
    Object.keys(effects({ vocab }, { desk: scribe, rest: '1h' })),
  )
  let warned: unknown[] = []
  let warn = console.warn
  console.warn = (...said: unknown[]) => warned.push(said[0])
  try {
    assertEquals(effects({ vocab }, { desk: scribe, rest: 'whenever' }), {})
  } finally {
    console.warn = warn
  }
  assert(String(warned[0]).includes('is no rest'))
})
