import { equal, test, throws } from '@yaks/testing'
import { type Bundle, graph, type Tool } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { toolsDoc } from './vocab.ts'
import { kernelDoc, kernelKeywords } from '@yaks/kernel'
import { runner, toolEid } from './runner.ts'

let vocab = loadVocab([toolsDoc, kernelDoc], [kernelKeywords])
let defect = new TypeError('missing field')
// Storage that refuses for good; a retryable refusal waits in persist instead.
let full = new Error('database or disk is full')
let fixture = (fail = false, error: unknown = defect) => {
  let storage = ram(vocab)
  let g = graph({ vocab, storage })
  // The reporter contract needs RAM's atomic patches, without admission and
  // stamp rules. Full graph writes are exercised by tools_test.ts.
  g.apply = (bundles) =>
    storage.tx((tx) => {
      tx.patch(bundles)
      return bundles
    })
  let tool: Tool = {
    name: 'broken',
    description: 'Fail',
    inputSchema: { type: 'object', properties: {} },
    run: () => {
      throw error
    },
  }
  let told: unknown[] = []
  let r = runner(g, { tools: [tool], report: (e) => told.push(e) })
  let apply = g.apply, writes = 0
  g.apply = (bundles, opts) => {
    if (bundles.some((b) => b.exception)) {
      writes++
      if (fail) throw full
    }
    return apply(bundles, opts)
  }
  let call: Bundle = {
    entity: { eid: 'call' },
    call: { to: toolEid('broken'), args: {} },
  }
  return { g, r, call, told, writes: () => writes }
}

let recorded = fixture()
test('a tool defect reports its original error once and keeps its answer in history', async () => {
  let { g, r, call, told, writes } = recorded
  let answer = await r.call(call)
  let fault = answer.find((b) => b.exception)!
  let [row] = await g.get([fault.entity.eid])
  equal(row.exception, {
    type: defect.name,
    value: defect.message,
  })
  equal(told, [defect])
  equal((told[0] as Error).stack, defect.stack)
  equal(writes(), 1)
})

let rejected = fixture(true)
test('a rejected tool exception write reports the original defect once', async () => {
  let { r, call, told, writes } = rejected
  equal(await throws(() => r.call(call)), full)
  equal(told.length, 1)
  equal(told[0] === defect, true)
  equal(writes(), 1)
})

test('an unrecorded tool defect reports directly and skips provider transients', async () => {
  for (let error of [defect, new Error('responses: HTTP 503')]) {
    let { g, call, told } = fixture(false, error)
    let tool: Tool = {
      name: 'broken',
      description: 'Fail',
      readOnly: true,
      run: () => {
        throw error
      },
    }
    let r = runner(g, { tools: [tool], report: (e) => told.push(e) })
    await r.read(call)
    equal(told, error === defect ? [defect] : [])
    equal(await g.read('.exception&*'), [])
  }
})
