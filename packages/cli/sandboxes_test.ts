// Missing sandbox configuration is a caller choice, not a provisioning failure.
// A failed adapter remains a real failure rather than being hidden as input.
import { equal, ok, test, throws } from '@yaks/testing'
import { graph, mint, Refused } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { kernelDoc } from '@yaks/kernel'
import { machineDoc } from '@yaks/machine/vocab'
import { docs as sandboxDocs } from '@yaks/sandbox/vocab'
import { docs as sessionDocs } from '@yaks/session/vocab'
import { docs as harnessDocs } from '@yaks/harness/vocab'
import { processDoc } from '@yaks/process'
import { sandboxCapabilities } from './sandboxes.ts'
import { machines } from '../harness/session_machines.ts'
import { harnessTools } from '../harness/tools.ts'
import type { SandboxProvider } from '@yaks/sandbox'

let vocab = loadVocab([
  kernelDoc,
  machineDoc,
  ...sandboxDocs,
  ...sessionDocs,
  ...harnessDocs,
  processDoc,
])
let g = graph({ storage: ram(vocab), vocab })
let session = mint(), workspace = mint()
await g.apply([{ entity: { eid: session }, session: {}, home: {} }, {
  entity: { eid: workspace },
  workspace: { root: '/explicit' },
}])
let sandboxes = sandboxCapabilities({ graph: g }, {})
let starts = 0, connects = 0
let workspaces = {
  connect: (id: string) => {
    equal(id, workspace)
    connects++
    return Promise.resolve({
      start: () => {
        starts++
        return Promise.resolve('process')
      },
      look: () => Promise.resolve({ exit: { code: 0 } }),
      tail: () => Promise.resolve(['explicit output']),
      kill: () => Promise.resolve(),
      read: () => Promise.resolve(''),
      stat: () => Promise.resolve([]),
      write: () => Promise.resolve(),
    })
  },
}
let tools = harnessTools(g, {
  machines: machines(g, sandboxes, undefined, workspaces),
  workspaces,
})
let shell = tools.find((t) => t.name === 'shell')!
let ctx = { session, call: { entity: { eid: mint() } }, entries: [] }
let absent = await throws(
  () => shell.run({ command: 'pwd' }, ctx),
  'no default sandbox provider',
)
let unchanged = (await g.get([session]))[0].home
let explicit = await shell.run(
  { command: 'pwd', workspace, cwd: '/explicit' },
  ctx,
)
let unknown = await throws(
  () => sandboxes.request(mint(), { provider: 'missing' }),
  'not configured',
)
let noBinding = await throws(
  () => machines(g).home(session),
  'no default sandbox provider',
)
let failed = Error('adapter genuinely failed')
let provider: SandboxProvider = {
  request: () => Promise.reject(failed),
  connect: () => Promise.reject(failed),
  dispose: () => Promise.reject(failed),
  export: async function* () {},
}
let configured = sandboxCapabilities({ graph: g }, {
  sandboxes: {
    defaultProvider: 'fixture',
    providers: { fixture: { provider } },
  },
})
let intended = mint()
await configured.request(intended)
let intention = (await g.get([intended]))[0]

test('a targetless native shell refuses without provisioning or changing home', () => {
  ok(absent instanceof Refused)
  equal(unchanged, {})
})
test('an explicit workspace shell runs without a default sandbox provider', () => {
  equal(starts, 1)
  equal(connects, 1)
  ok(String(explicit).includes('explicit output'))
})
test('unknown sandbox selection and absent host capability are refusals', () => {
  ok(unknown instanceof Refused)
  ok(noBinding instanceof Refused)
})
test('a configured sandbox records its intention without provisioning', () => {
  ok(intention.pending)
  equal((intention.sandbox as { provider: string }).provider, 'fixture')
})
