// Transient direct reads use the same validation and answer shape without
// committing runner bookkeeping or invoking a write reply.
import { equal, test, throws } from '@yaks/testing'
import {
  argsOf,
  type Bundle,
  type Comp,
  graph,
  mint,
  type Tool,
} from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { ram } from '@yaks/ram'
import { kernelDoc, kernelKeywords } from '@yaks/kernel'
import { answerOf, callDoc, faulted, runner, toolDoc, toolEid } from './mod.ts'
import { reader } from '@yaks/tools/read'

test('a direct read validates and answers without any graph write, even on refusal', async () => {
  for (let make of [runner, reader]) {
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
    let r = make(g, {
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
    let broken = make(g, {
      tools: [tool],
      report: () => {
        reports++
      },
    })
    equal(faulted(await broken.read(call), call.entity.eid), true)
    equal([writes, reports], [0, 1])
    let writer = make(g, { tools: [{ ...tool, readOnly: false }] })
    await throws(() => writer.read(call))
    equal(writes, 0)
  }
})

test('read runners share reference resolution, attribution, limits and receipts', async () => {
  let vocab = loadVocab([kernelDoc, callDoc, toolDoc], [kernelKeywords])
  let g = graph({ vocab, storage: ram(vocab) })
  let target = mint(),
    call = {
      entity: { eid: mint() },
      call: {
        to: toolEid('context_read'),
        args: { target: 'alias' },
        actor: { by: 'person', via: 'session' },
      },
    }
  g.use({ name: 'aliases', address: () => new Map([['alias', target]]) })
  let asking: Bundle | undefined
  let tool: Tool = {
    name: 'context_read',
    description: 'Read a named target',
    readOnly: true,
    inputSchema: {
      type: 'object',
      properties: { target: { type: 'string', ref: 'content' } },
    },
    run: (call) => {
      asking = call
      return [{
        entity: { eid: '$said' },
        content: { body: String(argsOf(call).target) },
      }]
    },
  }
  let answers: Bundle[][] = []
  for (let make of [runner, reader]) {
    let r = make(g, { tools: [tool], process: { kind: 'probe' }, now: () => 0 })
    let out = await r.read(call)
    equal(argsOf(asking!).target, target)
    equal(asking!.created, { by: 'person', via: 'session' })
    equal(asking!.process, { kind: 'probe' })
    equal(answerOf(out, call.entity.eid)[0].$actor, {
      by: 'person',
      via: 'session',
    })
    answers.push(out)
    let small = make(g, { tools: [tool], most: 1 })
    let fault = answerOf(await small.read(call), call.entity.eid)[0]
    equal((fault.refusal as Comp).code, 'too_large')
  }
  equal(answers[0], answers[1])
})
