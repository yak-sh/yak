// Retention seeks the old refusals, even when none of a long recent history
// is old enough. The index is installed over an existing populated store.
import { equal, ok, test } from '@yaks/testing'
import { type Graph, graph, mint } from '@yaks/graph'
import { storage } from '@yaks/sqlite'
import { stepping } from '../../packages/sqlite/testing.ts'
import { loadVocab } from '@yaks/vocab'
import { kernelDoc, kernelKeywords } from '@yaks/kernel'
import { toolsDoc } from '@yaks/tools'
import { docDoc } from '@yaks/doc'
import { mailDoc } from '@yaks/mail'
import { platformDoc } from '@yaks/platform/vocab'
import { forgotten } from './refusals.ts'

let previous = structuredClone(platformDoc)
delete previous.$defs!.tool_refusal.properties!.at.index
let words = [kernelDoc, toolsDoc, docDoc, mailDoc]
let vocab = loadVocab([...words, platformDoc], [kernelKeywords])
let before = loadVocab([...words, previous], [kernelKeywords])
let world = (n: number) => {
  let { driver, steps } = stepping()
  let old = storage(driver, before)
  old.install()
  let delivered = mint(), waiting = mint()
  let occurrence = (at: string, report?: string) => ({
    entity: { eid: mint() },
    tool_refusal: { at },
    ...report ? { counted: { report } } : {},
  })
  let aged = occurrence('2026-10-01T00:00:00.000Z', delivered)
  let pending = occurrence('2026-10-01T00:00:00.000Z', waiting)
  let uncounted = occurrence('2026-10-01T00:00:00.000Z')
  old.tx((tx) =>
    tx.patch([
      {
        entity: { eid: delivered },
        refusal_report: {},
        delivered: { at: '2026-10-02T00:00:00.000Z' },
      },
      { entity: { eid: waiting }, refusal_report: {} },
      aged,
      pending,
      uncounted,
      ...Array.from({ length: n }, () =>
        occurrence('2026-11-10T00:00:00.000Z', delivered)),
    ])
  )
  let store = storage(driver, vocab)
  store.install()
  let g = graph({ storage: store, vocab })
  let readSteps = 0
  let measured: Pick<Graph, 'read' | 'apply'> = {
    read: async (q, opts) => {
      let at = steps()
      let rows = await g.read(q, opts)
      readSteps = steps() - at
      return rows
    },
    apply: g.apply,
  }
  return {
    g,
    aged,
    pending,
    uncounted,
    n,
    forget: async (at: string) => ({
      removed: await forgotten(measured, at),
      steps: readSteps,
    }),
  }
}
let [small, large] = [64, 2048].map(world)

test('a retention query with no old refusals reads no recent history', async () => {
  let results = await Promise.all(
    [small, large].map((w) => w.forget('2026-09-01T00:00:00.000Z')),
  )
  equal(results.map((r) => r.removed), [0, 0])
  ok(
    results.every((r) => r.steps < 1000),
    `${
      results.map((r) => r.steps).join(', ')
    } VM steps for 64, 2048 recent refusals`,
  )
})

test('retention reads old refusals and keeps recent, uncounted and undelivered ones', async () => {
  let results = await Promise.all(
    [small, large].map((w) => w.forget('2026-11-11T00:00:00.000Z')),
  )
  equal(results.map((r) => r.removed), [1, 1])
  ok(
    results.every((r) => r.steps < 2000),
    `${
      results.map((r) => r.steps).join(', ')
    } VM steps for 64, 2048 recent refusals`,
  )
  for (let w of [small, large]) {
    equal(await w.g.get([w.aged.entity.eid]), [])
    equal((await w.g.read('.tool_refusal')).length, w.n + 2)
    equal(
      (await w.g.get([w.pending.entity.eid, w.uncounted.entity.eid])).length,
      2,
    )
  }
})
