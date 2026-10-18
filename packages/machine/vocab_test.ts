// A computer stores its explicit connection locator, not directory lifecycle.
import { equal, test } from '@yaks/testing'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { machineDoc } from './vocab.ts'
let vocab = loadVocab([machineDoc])
let g = graph({ storage: ram(vocab), vocab })
await g.apply([{
  entity: { eid: 'computer' },
  machine: { address: 'ssh://computer' },
}])
test('computer address records an explicit connection locator', async () => {
  equal((await g.get(['computer']))[0].machine, { address: 'ssh://computer' })
})
