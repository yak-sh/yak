// Transient direct reads use the same validation and answer shape without
// committing runner bookkeeping or invoking a write reply.
import { equal, test, throws } from '@yaks/testing'
import { argsOf, graph, mint, type Tool } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { ram } from '@yaks/ram'
import { kernelDoc, kernelKeywords } from '@yaks/kernel'
import { answerOf, callDoc, faulted, runner, toolDoc, toolEid } from './mod.ts'

test('a direct read validates and answers without any graph write, even on refusal', async () => {
  let vocab = loadVocab([kernelDoc, callDoc, toolDoc], [kernelKeywords])
  let g = graph({ vocab, storage: ram(vocab) })
  let writes = 0, replies = 0, reports = 0
  g.apply = () => {
    writes++
    throw new Error('read attempted to write')
  }
  let tool: Tool = {
    name: 'sample_read',
    description: 'Read a sample',
    readOnly: true,
    inputSchema: {
      type: 'object',
      properties: { value: { type: 'integer', default: 7 } },
    },
    run: (call) => [{
      entity: { eid: '$said' },
      content: { body: String(argsOf(call).value) },
      output: { source: call.entity.eid },
    }],
  }
  let r = runner(g, {
    tools: [tool],
    report: () => {
      reports++
    },
    reply: () => {
      replies++
      return Promise.resolve([])
    },
  })
  let ask = (args: Record<string, unknown>) => ({
    entity: { eid: mint() },
    call: { to: toolEid('sample_read'), args },
  })
  let call = ask({}), answer = await r.read(call)
  equal(
    (answerOf(answer, call.entity.eid)[0].content as { body: string }).body,
    '7',
  )
  equal(faulted(answer, call.entity.eid), false)
  let bad = ask({ value: 'bad' }), refusal = await r.read(bad)
  equal(faulted(refusal, bad.entity.eid), true)
  equal([writes, replies, reports], [0, 0, 0])
  tool.run = () => {
    throw new Error('defect')
  }
  // A fresh runner takes the changed tool value.
  let broken = runner(g, {
    tools: [tool],
    report: () => {
      reports++
    },
  })
  equal(faulted(await broken.read(call), call.entity.eid), true)
  equal([writes, reports], [0, 0])
  let writer = runner(g, { tools: [{ ...tool, readOnly: false }] })
  await throws(() => writer.read(call))
  equal(writes, 0)
})
