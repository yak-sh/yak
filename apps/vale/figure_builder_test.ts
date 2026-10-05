// Figure outputs enter through store admission; only current main looks draw.
import { test } from '@yaks/testing'
import { assert, assertEquals, assertRejects } from '@std/assert'
import { graph } from '@yaks/graph'
import { admitSchema } from '@yaks/graph/schema'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { builderDoc } from '@yaks/builders/vocab'
import { selected } from '@yaks/builders'
import { docDoc } from '@yaks/doc'
import { FIGURE_BUILDS, FIGURE_ROWS, FIGURES, useFigures } from './figure.ts'
import { comp } from './bundle.ts'
import { rows } from './figures_fixture.ts'
import words from './vocab.json' with { type: 'json' }
import builders from './data/figures/01.json' with { type: 'json' }

let vocab = loadVocab([words, builderDoc, docDoc])
let store = () => {
  let db = ram(vocab, {
    computed: { 'built.current': (row) => comp(row, 'built').key == 'current' },
  })
  return {
    db,
    g: graph({ vocab, storage: db, plugins: [admitSchema(vocab)] }),
  }
}
let source = rows[0].figure

test('all seeded figures pass store admission unchanged', async () => {
  let { g } = store()
  await g.apply(rows)
  assertEquals((await g.read('.figure')).length, rows.length)
})

test('figure admission refuses malformed, unsafe and cyclic geometry', async () => {
  let { g } = store(), eid = crypto.randomUUID()
  let put = (patch: Record<string, unknown>) =>
    g.apply([{ entity: { eid }, figure: patch }])
  await put(source)
  for (
    let patch of [
      { parts: [] },
      { parts: Array(33).fill(source.parts[0]) },
      { height: 0 },
      { height: 13 },
      { size: 9 },
      { dust: -1 },
      { glow: 16777216 },
      { speckle: 2 },
      { gait: 'execute' },
      { bite: 'script' },
      { fall: 'none' },
      { parts: [{ ...source.parts[0], boxes: [] }] },
      { parts: [{ ...source.parts[0], cell: 1e-9 }] },
      { parts: [{ ...source.parts[0], pivot: [0, 0] }] },
      { parts: [{ ...source.parts[0], pivot: [0, 0, 1e9] }] },
      { parts: [{ ...source.parts[0], boxes: [[[0, 0, 0], [0, 1, 1], 0]] }] },
      {
        parts: [{ ...source.parts[0], boxes: [[[0, 0, 0], [1, 1, 1], 'red']] }],
      },
      { parts: [{ ...source.parts[0], move: { run: {} } }] },
      { parts: [{ ...source.parts[0], move: { wing: { beat: 100 } } }] },
      { parts: [{ ...source.parts[0], parent: 'missing' }] },
      { parts: [{ ...source.parts[0], parent: source.parts[0].name }] },
      { parts: [source.parts[0], source.parts[0]] },
      {
        parts: [
          { ...source.parts[0], name: 'a', parent: 'b' },
          { ...source.parts[0], name: 'b', parent: 'a' },
        ],
      },
    ]
  ) {
    await assertRejects(async () => await put(patch), Error, 'figure.')
  }
  assertEquals((await g.get([eid]))[0].figure, source)
  await assertRejects(
    async () =>
      await g.apply([{
        entity: { eid: crypto.randomUUID() },
        figure: { of: source.of },
      }]),
    Error,
    'figure.parts is required',
  )
})

test('figure builder selects only main current kinds, not seeds or shadows', async () => {
  let { g, db } = store()
  let inputs = ['main', 'old', 'shadow'].flatMap((name) => [{
    entity: { eid: `${name}-build` },
    build: {
      builder: 'upstream',
      variant: name == 'shadow' ? 'shadow:trial' : 'main',
      key: name == 'old' ? 'new' : 'current',
    },
  }, {
    entity: { eid: name },
    beast_design: { name },
    doc: { body: 'A little moth.' },
    built: {
      build: `${name}-build`,
      slot: 'kind',
      key: name == 'old' ? 'old' : 'current',
    },
  }])
  await g.apply([
    {
      entity: { eid: 'upstream' },
      builder: {},
    },
    ...inputs,
    {
      entity: { eid: 'seed' },
      beast_design: { name: 'Seed' },
      doc: { body: 'A seeded creature.' },
    },
  ], { trusted: true })
  let found = await db.tx((tx) => selected(tx, builders[0], vocab))
  assertEquals(found.length, 1)
  assertEquals(found[0].binding.vars.kind, 'main')
  assertEquals(found[0].binding.vars.look, 'A little moth.')
})

test('figure subscription and installer leave stale and shadow outputs out', async () => {
  let { g } = store()
  let inputs = ['main', 'old', 'shadow'].flatMap((name) => [{
    entity: { eid: `${name}-build` },
    build: {
      builder: 'upstream',
      variant: name == 'shadow' ? 'shadow:trial' : 'main',
    },
  }, {
    entity: { eid: name },
    beast_design: { name },
    figure: { ...source, of: name },
    built: { build: `${name}-build`, key: name == 'old' ? 'old' : 'current' },
  }])
  await g.apply([
    {
      entity: { eid: 'upstream' },
      builder: {},
    },
    ...rows,
    ...inputs,
  ], { trusted: true })
  let filtered = await g.read(FIGURE_ROWS)
  let meta = await g.read(FIGURE_BUILDS)
  let at = new Map(filtered.map((row) => [row.entity.eid, row]))
  for (let row of meta) {
    let prior = at.get(row.entity.eid)
    at.set(row.entity.eid, {
      ...prior,
      ...row,
      built: { ...comp(prior, 'built'), ...comp(row, 'built') },
    })
  }
  useFigures([...at.values()])
  assert(FIGURES[source.of])
  assert(FIGURES.main)
  assertEquals(FIGURES.old, undefined)
  assertEquals(FIGURES.shadow, undefined)
  // Installation is defensive even if another caller passes unfiltered rows.
  useFigures([...at.values(), {
    entity: { eid: 'old' },
    figure: { ...source, of: 'old' },
    built: { current: false },
  }, {
    entity: { eid: 'shadow' },
    figure: { ...source, of: 'shadow' },
    built: { current: true, build: 'shadow-build' },
  }, { entity: { eid: 'shadow-build' }, build: { variant: 'shadow:trial' } }])
  assert(FIGURES.main)
  assertEquals(FIGURES.old, undefined)
  assertEquals(FIGURES.shadow, undefined)
  useFigures(rows)
})
