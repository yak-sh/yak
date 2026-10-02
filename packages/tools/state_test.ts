// Calls read the same outcome from marks and named answers in RAM and SQL.

import { equal, test } from '@yaks/testing'
import { type Bundle, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { storage } from '@yaks/sqlite'
import { mem } from '../sqlite/testing.ts'
import { loadVocab, type VocabDoc } from '@yaks/vocab'
import { kernelDoc, kernelKeywords } from '@yaks/kernel'
import { sessionDoc } from '@yaks/session'
import { toolsDoc } from './vocab.ts'
import { executionComputed, executionDerived } from './state.ts'
import { attemptComputed, attemptDerived } from '../session/attempt.ts'

let words = (): VocabDoc => {
  let defs = structuredClone(toolsDoc.$defs!)
  defs.execution.properties!.state.computed = true
  return { $defs: defs }
}
let sessions = (): VocabDoc => {
  let defs = structuredClone(sessionDoc.$defs!)
  defs.attempt.properties!.state.computed = true
  defs.attempt.properties!.by = { type: 'string', ref: 'entity', death: 'keep' }
  return { $defs: defs }
}

for (let sql of [false, true]) {
  test(`lifecycle reads and filters ${sql ? 'SQL' : 'RAM'}`, async () => {
    let vocab = loadVocab([kernelDoc, words(), sessions()], [kernelKeywords])
    let s = sql
      ? storage(mem(), vocab, {
        derived: { ...executionDerived(vocab), ...attemptDerived(vocab) },
      })
      : ram(vocab, { computed: { ...executionComputed, ...attemptComputed } })
    s.install()
    let g = graph({ vocab, storage: s })
    await g.apply([
      { entity: { eid: 'owner' } },
      { entity: { eid: 'held' }, execution: { by: 'owner' } },
      { entity: { eid: 'done' }, execution: { by: 'owner' } },
      { entity: { eid: 'failed' }, execution: {} },
      { entity: { eid: 'defect' }, execution: {} },
      {
        entity: { eid: 'cut' },
        execution: {},
        interrupted: { code: 'restart' },
      },
      { entity: { eid: 'unclaimed' } },
      { entity: { eid: 'r1' }, result: { call: 'done' } },
      { entity: { eid: 'r2' }, result: { call: 'failed' } },
      {
        entity: { eid: 'f1' },
        output: { source: 'failed' },
        refusal: { code: 'no' },
      },
      { entity: { eid: 'f2' }, output: { source: 'defect' }, exception: {} },
      {
        entity: { eid: 'f3' },
        result: { call: 'cut' },
        refusal: { code: 'no' },
      },
      { entity: { eid: 'ask1' }, attempt: { by: 'owner' } },
      { entity: { eid: 'ask2' }, attempt: {} },
      {
        entity: { eid: 'ask3' },
        attempt: { by: 'owner' },
        interrupted: { code: 'transport' },
      },
    ])
    let ids = async (query: string) =>
      (await g.read(query)).map((b) => b.entity.eid).sort()
    equal(await ids('.execution.state=running'), ['held'])
    equal(await ids('.execution.state=done'), ['done'])
    equal(await ids('.execution.state=failed'), ['defect', 'failed'])
    equal(await ids('.execution.state=interrupted'), ['cut'])
    equal(await ids('.attempt.state=inflight'), ['ask1'])
    equal(await ids('.attempt.state=completed'), ['ask2'])
    equal(await ids('.attempt.state=interrupted'), ['ask3'])
    let [held]: Bundle[] = await g.get(['held'])
    equal(held.execution, { by: 'owner', state: 'running' })
    await g.apply([{ entity: held.entity, execution: { by: null } }])
    equal(await ids('.execution.state=running'), [])
    await g.apply([{
      entity: { eid: 'ask3' },
      interrupted: null,
      attempt: { by: null },
    }])
    equal(await ids('.attempt.state=completed'), ['ask2', 'ask3'])
  })
}
