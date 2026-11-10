// Who hears a refusal: every way a call is refused reaches `refused`, once,
// beside its answer, and a defect reaches `report` alone.
import { equal, test } from '@yaks/testing'
import { type Bundle, graph, type Tool } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { kernelDoc, kernelKeywords } from '@yaks/kernel'
import { CallError, type Refusal, runner, toolEid, toolsDoc } from './mod.ts'

let vocab = loadVocab([toolsDoc, kernelDoc], [kernelKeywords])
let g = graph({ vocab, storage: ram(vocab) })
let tool = (name: string, run: Tool['run']): Tool => ({
  name,
  description: name,
  inputSchema: {
    type: 'object',
    properties: { n: { type: 'integer' } },
  },
  run,
})
let tools = [
  tool('fine', () => []),
  tool('no', () => {
    throw new CallError('limit', 'too many today')
  }),
  // A write naming a word the graph does not hold: the graph refuses it.
  tool('misfit', () => [{ entity: { eid: '$x' }, nowhere: { at: 1 } }]),
  tool('broken', () => {
    throw new TypeError('undefined is not a function')
  }),
]
let unserved = tool('unserved', () => {
  throw new CallError('tool', 'no such tool')
})
let heard: [Refusal, string, string | undefined][] = []
let told: unknown[] = []
let r = runner(g, {
  tools,
  otherwise: unserved,
  refused: (refusal, call, name) => {
    heard.push([refusal, call.entity.eid, name])
  },
  report: (e) => told.push(e),
})
let n = 0
let asking = async (to: string, args: Record<string, unknown> = {}) => {
  heard.length = 0
  told.length = 0
  let call: Bundle = {
    entity: { eid: `call-${++n}` },
    call: { to: toolEid(to), args },
  }
  let answer = await r.call(call)
  return { id: call.entity.eid, answer }
}
let codeOf = (answer: Bundle[]) =>
  (answer.find((b) => b.refusal)?.refusal as { code?: string })?.code

test('every refusal is heard once with its code, its call and its tool', async () => {
  for (
    let [to, args, code, by] of [
      ['fine', { n: 'two' }, 'arguments', 'fine'],
      ['no', {}, 'limit', 'no'],
      ['misfit', {}, 'Refused', 'misfit'],
      ['missing', {}, 'tool', 'unserved'],
    ] as const
  ) {
    let { id, answer } = await asking(to, args)
    equal(heard.map(([r, call, name]) => [r.code, call, name]), [[
      code,
      id,
      by,
    ]])
    equal(codeOf(answer), code)
    equal(heard[0][0].said.length > 0, true)
    equal(told, [])
  }
})

test('a defect is reported and never heard as a refusal', async () => {
  await asking('broken')
  equal(heard, [])
  equal(told.length, 1)
})

test('an answered call is heard by nobody', async () => {
  await asking('fine', { n: 2 })
  equal([heard, told], [[], []])
})

test("a hearer's failure is reported and leaves the refusal the answer", async () => {
  let failing = runner(g, {
    tools,
    refused: () => {
      throw new Error('hearer down')
    },
    report: (e) => told.push(e),
  })
  told.length = 0
  let answer = await failing.call({
    entity: { eid: 'call-failing' },
    call: { to: toolEid('no'), args: {} },
  })
  equal(codeOf(answer), 'limit')
  equal(told.map((e) => (e as Error).message), ['hearer down'])
})
