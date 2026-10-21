// Presence alternatives filter the indexed owner's range even on the first
// read after a write. Other owners' matching shapes never enlarge that range.
import { type Bundle, graph } from '@yaks/graph'
import { kernelDoc, kernelKeywords } from '@yaks/kernel'
import { sessionDoc } from '@yaks/session'
import { sessionDerived } from '../session/status.ts'
import { toolsDoc } from '@yaks/tools/vocab'
import { modelDoc } from '@yaks/model/vocab'
import { fileDoc } from '@yaks/file/vocab'
import { fileOf } from '@yaks/file'
import { archetypeDoc } from '@yaks/archetype/vocab'
import { loadVocab } from '@yaks/vocab'
import { compile, fn, val } from '@yaks/sql'
import { parse } from '@yaks/query'
import { equal, ok, test } from '@yaks/testing'
import { storage } from './mod.ts'
import { catalog } from './catalog.ts'
import { stepping } from './testing.ts'

let vocab = loadVocab([
  kernelDoc,
  sessionDoc,
  toolsDoc,
  modelDoc,
  fileDoc,
  archetypeDoc,
  { $defs: { apply_receipt: { component: true, type: 'object' } } },
], [kernelKeywords])
let derived = sessionDerived(vocab)
let status = derived['session.status'].expr
let marker = 'presence_status_probe'
derived['session.status'].expr = (owner) =>
  fn('coalesce', status(owner), val(marker))
let { driver: d, steps } = stepping()
let query = d.query.bind(d), computed = 0
d.query = (q) => {
  let rows = query(q)
  if (rows.length && JSON.stringify(q).includes(marker)) computed++
  return rows
}
let s = storage(d, vocab, { derived })
s.install()
let file = fileOf('disk', 'fixture.jsonl')
let line = (eid: string, owner: string, seq: number): Bundle => ({
  entity: { eid },
  entry: { session: owner, seq },
  lines: { file, start: seq },
  content: { body: 'precious prose' },
})
s.tx((tx) =>
  tx.patch([
    { entity: { eid: 'quiet' }, session: {} },
    { entity: { eid: 'other' }, session: {} },
    ...Array.from({ length: 3000 }, (_, seq) =>
      line(`line${String(seq).padStart(5, '0')}`, 'quiet', seq)),
    ...Array.from({ length: 1000 }, (_, seq) => ({
      ...line(`outside${seq}`, 'other', seq),
      result: {},
    })),
    { ...line('eligible', 'quiet', 3000), result: {} },
    { ...line('paid', 'quiet', 3001), result: {}, cost: {} },
    { ...line('provider', 'quiet', 3002), result: {}, using: {} },
    {
      entity: { eid: 'call' },
      entry: { session: 'quiet', seq: 3003 },
      lines: { file, start: 3003 },
    },
  ])
)
let g = graph({
  storage: s,
  vocab,
  plugins: [{ name: 'scope', scope: () => ({ entity: '!apply_receipt' }) }],
})
let selector = '.lines !using !cost ' +
  '(!content|.reasoning|.notice|.result|.refusal|.exception|.stop|.usage) ' +
  '.entry.session=quiet .fields=entity.eid .order=entity.eid .limit=50'
let costs = []
for (let phase of ['first', 'warm', 'after write']) {
  if (phase == 'after write') {
    s.tx((tx) => tx.patch([{ ...line('late', 'quiet', 3004), notice: {} }]))
  }
  let before = steps(), rows = await g.rows(selector)
  costs.push({ phase, rows: rows.map((r) => r.eid), steps: steps() - before })
}
for (let { phase, rows, steps } of costs) {
  test(`owner presence alternatives stay bounded ${phase}`, () => {
    equal(
      rows,
      phase == 'after write'
        ? ['call', 'eligible', 'late']
        : ['call', 'eligible'],
    )
    ok(steps < 100_000, `${steps} VM steps`)
  })
}
let projected = computed
await g.get(['quiet'])
let control = computed

test('projected owner selections leave computed session status unread', () => {
  equal(projected, 0)
  ok(control > 0)
})

let scoped = (
  visibility?: NonNullable<Parameters<typeof compile>[2]>['visibility'],
) => {
  let q = compile(parse(selector), vocab, {
    derived,
    visibility,
    archetypes: catalog(d),
  })
  return d.query(q).map((r) => r.eid)
}
let controls = [
  ['owner scope', { entity: '.entity.eid!=eligible' }, ['call', 'late']],
  [
    'masked marker',
    { components: { result: '.entity.eid!=eligible' } },
    ['call', 'late'],
  ],
  [
    'masked prose',
    { components: { content: '.entity.eid!=line00000' } },
    ['call', 'eligible', 'late', 'line00000'],
  ],
  [
    'masked owner reference',
    { components: { entry: '.entity.eid=outside0' } },
    [],
  ],
] as const
for (let [name, visibility, expected] of controls) {
  let rows = scoped(visibility)
  test(`owner presence alternatives preserve ${name}`, () => {
    equal(rows, [...expected])
  })
}
let valued = s.rows(
  '.entry.session=quiet (.notice|.entry.seq=0) .fields=entity.eid',
).map((r) => r.eid).sort()
let paged = s.rows(selector + ' .after=eligible').map((r) => r.eid)
let missing = s.rows(selector.replace('session=quiet', 'session=missing'))
let bounded = s.rows(selector + ' .entity.eid=eligible').map((r) => r.eid)
let fallbacks = [undefined, () => undefined].map((archetypes) =>
  d.query(compile(parse(selector), vocab, { derived, archetypes }))
    .map((r) => r.eid)
)
test('owner alternatives retain valued arms, cursors and bounded ranges', () => {
  equal(valued, ['late', 'line00000'])
  equal(paged, ['late'])
  equal(missing, [])
  equal(bounded, ['eligible'])
})
test('owner alternatives keep uncatalogued and incomplete catalog answers', () => {
  for (let rows of fallbacks) equal(rows, ['call', 'eligible', 'late'])
})
console.log('OWNER_PRESENCE_COST', JSON.stringify(costs))
