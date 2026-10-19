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

let missingRead = executionWorkspace(g, {
  execute: () => Promise.resolve('path\n'),
}, target)
test('a missing user file is a path refusal rather than a connector failure', async () => {
  let error = await throws(() => missingRead.read('absent'))
  equal((error as Error).name, 'CallError')
})

// Exercise the actual control-script boundary: a user's failed command must
// produce a durable exit receipt, never reject the computer control request.
let localFailures = await (async () => {
  let { localConnector } = await import('./connectors.ts')
  let { machineTools } = await import('./tools.ts')
  let dir = await Deno.makeTempDir({ prefix: 'workspace-user-failures-' })
  let workspace = mint()
  await g.apply([{ entity: { eid: workspace }, workspace: { root: dir } }])
  let m = executionWorkspace(g, await localConnector().connect('local://'), {
    workspace,
    root: dir,
    receipts: dir + '/receipts',
  })
  let shell = machineTools(m).find((t) => t.name == 'shell')!
  try {
    let result = await shell.run({
      command: dir + '/not-a-command',
      timeout: 2000,
    })
    let pathFault: unknown
    try {
      await m.read('not-a-file')
    } catch (e) {
      pathFault = e
    }
    return { result, pathFault }
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
})()
test('user command exit 127 is returned as a shell result at the local connector boundary', () => {
  equal(localFailures.result.includes('exited 127'), true)
  equal(localFailures.result.includes('not-a-command'), true)
})
test('missing user paths are refusals through the actual local control script', () => {
  equal((localFailures.pathFault as Error).name, 'CallError')
})

// A new session alone still belongs to the launcher's service cgroup. The
// service manager must not own a receipt's command when that launcher drains.
let isolation = await (async () => {
  if (Deno.build.os != 'linux') return
  try {
    await Deno.stat('/run/systemd/system')
  } catch {
    return
  }
  let { localConnector } = await import('./connectors.ts')
  let { until } = await import('@yaks/testing')
  let dir = await Deno.makeTempDir({ prefix: 'workspace-scope-' })
  let workspace = mint()
  await g.apply([{ entity: { eid: workspace }, workspace: { root: dir } }])
  let m = executionWorkspace(g, await localConnector().connect('local://'), {
    workspace,
    root: dir,
    receipts: dir + '/receipts',
  })
  try {
    let id = await m.start('cat /proc/self/cgroup')
    await until(async () => (await m.look(id))?.exit != null)
    return {
      own: (await Deno.readTextFile('/proc/self/cgroup')).trim(),
      child: (await m.tail(id, 10)).join('\n').trim(),
    }
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
})()
test('workspace commands live outside their launching systemd unit', () => {
  if (isolation) equal(isolation.child == isolation.own, false)
})
