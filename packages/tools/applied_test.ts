// A host boundary can commit a tool's answer in another graph. Its runner
// records the invocation without writing that answer into its own graph.
import { equal, test } from '@yaks/testing'
import {
  argsOf,
  type Bundle,
  type Comp,
  graph,
  mint,
  type Tool,
} from '@yaks/graph'
import { kernelDoc, kernelKeywords } from '@yaks/kernel'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import {
  answerOf,
  CallError,
  executionComputed,
  faulted,
  runner,
  toolEid,
  toolsDoc,
} from './mod.ts'

let vocab = loadVocab([kernelDoc, toolsDoc], [kernelKeywords])
// This seam needs RAM's atomic patches and queryable call records. Admission
// and provenance are exercised by tools_test.ts; they do not decide whether
// the runner submits a boundary's answer for another write.
let world = () => {
  let storage = ram(vocab, { computed: executionComputed })
  let g = graph({ vocab, storage }), rollback = {}
  g.apply = (bundles, opts) => {
    try {
      return storage.tx((tx) => {
        tx.patch(bundles)
        if (opts?.check) throw rollback
        return bundles
      })
    } catch (error) {
      if (error != rollback) throw error
      return bundles
    }
  }
  return g
}
let ask = (args = {}): Bundle => ({
  entity: { eid: mint() },
  created: { by: 'caller' },
  call: { to: toolEid('remote_write'), args },
})
let fixture = (refuse = false) => {
  let source = world(), ledger = world(), checked = false
  let made: Bundle[] = [], wrote: Bundle[] | undefined
  let replied: Bundle[] = []
  let tool: Tool = {
    name: 'remote_write',
    description: 'Write through another host',
    applied: true,
    inputSchema: {
      type: 'object',
      properties: { check: { type: 'boolean' } },
    },
    run: async (call) => {
      if (refuse) throw new CallError('denied', 'the host refused')
      checked = argsOf(call).check === true
      made = await source.apply([{
        entity: { eid: 'remote-row' },
        content: { body: 'committed' },
      }], { check: checked })
      return made
    },
  }
  let r = runner(ledger, {
    tools: [tool],
    reply: (_, answer, written) => {
      replied = answer
      wrote = written
      return Promise.resolve([])
    },
  })
  return {
    source,
    ledger,
    r,
    made: () => made,
    replied: () => replied,
    wrote: () => wrote,
    checked: () => checked,
  }
}

let committed = fixture()
test('an applied writer returns its committed answer and records only the invocation locally', async () => {
  let { source, ledger, r, made, replied, wrote } = committed
  let call = ask(), answer = await r.call(call)
  equal(answerOf(answer, call.entity.eid), made())
  equal(replied(), made())
  equal(await source.get(['remote-row']), made())
  equal(await ledger.get(['remote-row']), [])
  equal(wrote(), [])
  let [stored] = await ledger.get([call.entity.eid])
  equal(stored.call, call.call)
  equal((stored.execution as Comp).state, 'done')
  equal((await ledger.read(`.result.call=${call.entity.eid}&*`)).length, 1)
})

let rehearsal = fixture()
test('an applied writer delegates rehearsal to its host without applying its answer locally', async () => {
  let { source, ledger, r, checked } = rehearsal
  let apply = ledger.apply
  ledger.apply = (bundles, opts) => {
    equal(opts?.check, undefined)
    return apply(bundles, opts)
  }
  let call = ask({ check: true }), answer = await r.call(call)
  equal(checked(), true)
  equal(faulted(answer, call.entity.eid), false)
  equal(answerOf(answer, call.entity.eid)[0].content, { body: 'committed' })
  equal(await source.get(['remote-row']), [])
  equal(await ledger.get(['remote-row']), [])
})

let refused = fixture(true)
test('an applied writer still records a refusal in its invocation ledger', async () => {
  let { ledger, r } = refused
  let call = ask(), answer = await r.call(call)
  equal(faulted(answer, call.entity.eid), true)
  let [fault] = await ledger.read(
    `.output.source=${call.entity.eid}&.refusal&*`,
  )
  equal(fault.refusal, { code: 'denied' })
  let [stored] = await ledger.get([call.entity.eid])
  equal((stored.execution as Comp).state, 'failed')
  equal((await ledger.read(`.result.call=${call.entity.eid}&*`)).length, 1)
})
