// Recovery is bound to the launch workspace, never a caller's later default.
import { equal, test, throws } from '@yaks/testing'
import { graph, mint } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { kernelDoc } from '@yaks/kernel'
import { processDoc } from '@yaks/process'
import { machineDoc } from './vocab.ts'
import { executionWorkspace } from './execution.ts'

let vocab = loadVocab([kernelDoc, machineDoc, processDoc])
let g = graph({ storage: ram(vocab), vocab })
let workspace = mint(), other = mint(), call = mint()
await g.apply([
  { entity: { eid: workspace }, workspace: { root: '/repo' } },
  { entity: { eid: other }, workspace: { root: '/other' } },
])
let scripts: string[] = [], state = 'pending'
let transport = {
  execute: (script: string) => {
    scripts.push(script)
    return Promise.resolve(script.includes("printf 'exit '") ? state : '')
  },
}
let target = { workspace, root: '/repo', receipts: '/receipts' }
let first = executionWorkspace(g, transport, target)
let id = await first.start('printf once', undefined, call)
let recovered = executionWorkspace(g, transport, target)
let receipt = await recovered.receipt!(call)
state = 'exit 7'
let ended = await recovered.look(id)

test('workspace command receipt survives reconnect with original output and exit handle', () => {
  equal(receipt, id)
  equal(ended?.exit, { code: 7 })
  equal(scripts.some((s) => s.includes(`/receipts/${workspace}/${id}`)), true)
})

test('a workspace refuses another workspace process rather than inspecting its pid', async () => {
  let wrong = executionWorkspace(g, transport, { ...target, workspace: other })
  await throws(() => wrong.look(id))
})

test('retrying a durable call with a different command cannot overwrite its receipt', async () => {
  await throws(() => recovered.start('printf twice', undefined, call))
})

test('workspace connection errors propagate with no local execution fallback', async () => {
  let bad = executionWorkspace(g, {
    execute: () => Promise.reject(new Error('unreachable')),
  }, target)
  await throws(() => bad.read('/missing'))
})

// A local observer must not signal or classify an unrelated local pid that
// happens to have the same number as a remote command.
let foreign = mint()
await g.apply([{
  entity: { eid: foreign },
  process: { workspace, pid: 424242 },
}])
let { watch, vanished, gone, store } = await import('@yaks/process')
let localStore = store(g)
let touched = 0
let opts = {
  running: () => {
    touched++
    return Promise.resolve(false)
  },
}
let resumed = await watch(localStore, opts)
let missing = await vanished(localStore, opts)
let over = await gone(localStore, foreign, opts)
test('local process observers leave workspace-qualified runs to their connector', () => {
  equal(resumed, [])
  equal(missing, [])
  equal(over, false)
  equal(touched, 0)
})
