import { equal, test } from '@yaks/testing'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { docs } from './vocab.ts'
import { machineDoc } from '@yaks/machine/vocab'
import { docs as sessionDocs } from '@yaks/session/vocab'
import { kernelDoc } from '@yaks/kernel'
import { sandboxDoc } from '@yaks/sandbox/vocab'
import { machines } from './session_machines.ts'
import { sessionHome } from '@yaks/machine/targets'
import { sandboxNew } from '@yaks/sandbox/lifecycle'
import type { SandboxProvider } from '@yaks/sandbox'

let vocab = loadVocab([
  kernelDoc,
  ...docs,
  machineDoc,
  ...sessionDocs,
  sandboxDoc,
])
let g = graph({ storage: ram(vocab), vocab })
await g.apply([
  { entity: { eid: 'first' }, workspace: { root: '/first' } },
  { entity: { eid: 'second' }, workspace: { root: '/second' } },
  {
    entity: { eid: 'session' },
    session: {},
    home: { workspace: 'first', cwd: '/first/sub' },
  },
])
let files = new Map<string, Map<string, string>>([[
  'first',
  new Map([['kept', 'edits']]),
], ['second', new Map()]])
let connections: string[] = []
let binding = machines(g, undefined, undefined, {
  connect: (id) => {
    connections.push(id)
    return Promise.resolve({
      start: () => Promise.resolve(''),
      look: () => Promise.resolve(null),
      tail: () => Promise.resolve([]),
      kill: async () => {},
      read: (path) => Promise.resolve(files.get(id)!.get(path)!),
      stat: () => Promise.resolve([]),
      write: (path, content) => {
        files.get(id)!.set(path, content)
        return Promise.resolve()
      },
    })
  },
})
await binding.machine('session')
await sessionHome(g, 'session', 'second')
await (await binding.machine('session')).write('next', 'other edits')
await binding.release('session')
test('switching a session default retains each workspace files and reconnects the selected target', async () => {
  await sessionHome(g, 'session', 'first')
  equal(await (await binding.machine('session')).read('kept'), 'edits')
  equal(files.get('second')!.get('next'), 'other edits')
  equal(connections, ['first', 'second', 'first'])
})
let defaults = graph({ storage: ram(vocab), vocab })
await defaults.apply([{ entity: { eid: 'parent' }, session: {} }])
let requests = 0
let provider: SandboxProvider = {
  request: () => {
    requests++
    return Promise.reject(
      new Error('Provisioning is not an opening side effect'),
    )
  },
  connect: () => {
    return Promise.reject(new Error('Not ready'))
  },
  dispose: () => {
    return Promise.reject(new Error('No automatic disposal'))
  },
  export: async function* () {},
}
let defaultBinding = machines(defaults, {
  request: async (id) => {
    await sandboxNew(defaults, { chosen: { provider } }, {
      id,
      provider: 'chosen',
    })
    return id
  },
})
test('a default records one sandbox intention without provisioning or releasing it', async () => {
  let at = await defaultBinding.home('parent')
  equal(await defaultBinding.home('parent'), at)
  let row = (await defaults.get([String(at.workspace)]))[0]
  equal((row.sandbox as { provider: string }).provider, 'chosen')
  equal(row.workspace, {})
  equal(!!row.pending, true)
  await defaultBinding.release('parent')
  equal(requests, 0)
  equal((await defaults.get([String(at.workspace)]))[0].released, undefined)
})
let missing = graph({ storage: ram(vocab), vocab })
await missing.apply([{ entity: { eid: 'session' }, session: {} }])
test('an unconfigured default refuses without inventing a process directory', async () => {
  let failed = false
  try {
    await machines(missing).home('session')
  } catch {
    failed = true
  }
  equal(failed, true)
  equal((await missing.get(['session']))[0].home, undefined)
})
let childGraph = graph({ storage: ram(vocab), vocab })
await childGraph.apply([
  { entity: { eid: 'tree' }, workspace: { root: '/repo' } },
  {
    entity: { eid: 'p' },
    session: {},
    home: { workspace: 'tree', cwd: '/repo/sub' },
  },
])
let children = machines(childGraph)
test('prompt children share a workspace and resolve command directories without moving it', async () => {
  let result = await children.limits.prepareChild!(
    { parent: 'p', child: 'c', args: { cwd: '../other' } } as Parameters<
      NonNullable<typeof children.limits.prepareChild>
    >[0],
  )
  equal(result.home, { workspace: 'tree', cwd: '/repo/other' })
  equal((await childGraph.get(['p']))[0].home, {
    workspace: 'tree',
    cwd: '/repo/sub',
  })
})
