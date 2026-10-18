// Provisioning history and workspace placement survive deletion of external
// resource records; lifecycle status is derived rather than written.
import { equal, test } from '@yaks/testing'
import { type Comp, graph, mint } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { kernelDoc } from '@yaks/kernel'
import { machineDoc } from '@yaks/machine/vocab'
import { sandboxDoc } from './vocab.ts'

let vocab = loadVocab([kernelDoc, machineDoc, sandboxDoc])
let g = graph({ storage: ram(vocab), vocab })
let computer = mint(), sandbox = mint()
await g.apply([
  { entity: { eid: computer }, machine: { address: 'ssh://example' } },
  {
    entity: { eid: sandbox },
    sandbox: { provider: 'example' },
    workspace: { machine: computer, root: '/workspace' },
    pending: {},
  },
])

let requested = ((await g.get([sandbox]))[0].sandbox as Comp)?.status
await g.apply([
  { entity: { eid: sandbox }, pending: null, released: {} },
  { entity: { eid: computer }, $delete: true },
])
let [row] = await g.get([sandbox])

test('sandbox status follows disposal and keeps original computer history', () => {
  equal(requested, 'requested')
  equal((row.sandbox as Comp)?.status, 'released')
  equal(row.workspace, { machine: computer, root: '/workspace' })
})
