// During the marks expansion, old dispatch state writes remain authoritative.
// Read and filter through the real SQL store, including session's queued check.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { type Bundle, graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { storage } from '@yaks/sqlite'
import { mem } from '../sqlite/testing.ts'
import { kernelDoc } from '@yaks/kernel/vocab'
import { modelDoc } from '@yaks/model'
import { toolsDoc } from '@yaks/tools/vocab'
import { sessionDoc } from './comp.ts'
import { dispatchStatus, sessionDerived } from './status.ts'

let vocab = loadVocab([kernelDoc, sessionDoc, toolsDoc, modelDoc])
let store = () => {
  let s = storage(mem(), vocab, { derived: sessionDerived(vocab) })
  s.install()
  return graph({ storage: s, vocab })
}

let cases: [string, Record<string, unknown>, string | null][] = [
  ['absent', {}, null],
  ['marks without dispatch', { admitted: {}, waiting: {} }, null],
  ['queued', { dispatch: {} }, 'queued'],
  ['active', { dispatch: {}, admitted: {} }, 'active'],
  ['waiting', { dispatch: {}, waiting: {} }, 'waiting'],
  ['waiting first', { dispatch: {}, admitted: {}, waiting: {} }, 'waiting'],
  ['legacy queued', {
    dispatch: { state: 'queued' },
    admitted: {},
    waiting: {},
  }, 'queued'],
  ['legacy active', { dispatch: { state: 'active' }, waiting: {} }, 'active'],
  [
    'legacy waiting',
    { dispatch: { state: 'waiting' }, admitted: {} },
    'waiting',
  ],
  ['legacy settled', {
    dispatch: { state: 'settled' },
    admitted: {},
    waiting: {},
  }, 'settled'],
  ['legacy empty', { dispatch: { state: '' }, waiting: {} }, ''],
]

test('dispatch compatibility reads and filters legacy state before marks', () => {
  let g = store()
  g.apply(cases.map(([eid, comps]) => ({ entity: { eid }, ...comps })), {
    trusted: true,
  })
  for (let [eid, , expected] of cases) {
    let [b] = g.get([eid]) as Bundle[]
    assertEquals(
      (b.dispatch as Record<string, unknown> | undefined)?.status ?? null,
      expected,
      eid,
    )
  }
  for (let status of dispatchStatus.values) {
    let got = (g.read(`.dispatch.status=${status}`) as Bundle[]).map((b) =>
      b.entity.eid
    ).sort()
    assertEquals(
      got,
      cases.filter(([, , expected]) => expected == status).map(([eid]) => eid)
        .sort(),
    )
  }
})

test('clearing legacy state exposes marks and removing dispatch clears status', () => {
  let g = store()
  let patch = (comps: Record<string, unknown>) =>
    g.apply([{ entity: { eid: 'child' }, ...comps }], { trusted: true })
  let status = () =>
    ((g.get(['child']) as Bundle[])[0].dispatch as
      | Record<string, unknown>
      | undefined)?.status ?? null
  patch({ dispatch: { state: 'queued' }, admitted: {}, waiting: {} })
  assertEquals(status(), 'queued')
  patch({ dispatch: { state: null } })
  assertEquals(status(), 'waiting')
  patch({ waiting: null })
  assertEquals(status(), 'active')
  patch({ admitted: null })
  assertEquals(status(), 'queued')
  patch({ dispatch: { state: 'active' }, waiting: {} })
  assertEquals(status(), 'active')
  patch({ dispatch: null })
  assertEquals(status(), null)
  assertEquals(g.read('.dispatch.status=waiting'), [])
})

test('session queued uses the same compatible dispatch status', () => {
  let g = store()
  for (let [eid, comps] of cases) {
    g.apply([
      { entity: { eid }, session: { id: eid }, ...comps },
      {
        entity: { eid: `${eid}/input` },
        entry: { session: eid, seq: 1 },
        content: { body: 'hello' },
      },
    ], { trusted: true })
  }
  let got = (g.read('.session.status=queued') as Bundle[]).map((b) =>
    b.entity.eid
  ).sort()
  assertEquals(
    got,
    cases.filter(([, , expected]) => expected == 'queued').map(([eid]) => eid)
      .sort(),
  )
})

// Legacy compositions do not yet know the marks. The compatibility expression
// must not read their missing tables or render an empty CASE expression.
test('dispatch compatibility also works without kernel marks', () => {
  let v = loadVocab([sessionDoc, toolsDoc, modelDoc])
  let s = storage(mem(), v, { derived: sessionDerived(v) })
  s.install()
  let g = graph({ storage: s, vocab: v })
  g.apply([
    { entity: { eid: 'queued' }, dispatch: {} },
    { entity: { eid: 'active' }, dispatch: { state: 'active' } },
  ], { trusted: true })
  let status = (eid: string) =>
    ((g.get([eid]) as Bundle[])[0].dispatch as Record<string, unknown>).status
  assertEquals(status('queued'), 'queued')
  assertEquals(status('active'), 'active')
  assertEquals(
    (g.read('.dispatch.status=queued') as Bundle[]).map((b) => b.entity.eid),
    ['queued'],
  )
})
