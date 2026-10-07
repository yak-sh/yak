// The graph record accepts lifecycle patches and refuses a provider's invalid
// state before it can become a machine row.

import { equal, test, throws } from '@yaks/testing'
import { graph, mint } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { machineDoc } from './vocab.ts'
import { gitDoc } from '@yaks/git/vocab'

test('machine lifecycle patches preserve provider and provenance', async () => {
  let vocab = loadVocab([machineDoc, gitDoc])
  let g = graph({ storage: ram(vocab), vocab })
  let eid = mint()
  await g.apply([{
    entity: { eid: 'commit' },
    gitobj: { type: 'commit', size: 0 },
  }])
  await g.apply([{
    entity: { eid },
    machine: { provider: 'remote', from: 'commit', state: 'requested' },
  }])
  for (let state of ['running', 'asleep', 'running', 'released']) {
    await g.apply([{ entity: { eid }, machine: { state } }])
    equal((await g.get([eid]))[0].machine, {
      provider: 'remote',
      from: 'commit',
      state,
    })
  }
  throws(() => g.apply([{ entity: { eid }, machine: { state: 'unknown' } }]))
  equal((await g.get([eid]))[0].machine, {
    provider: 'remote',
    from: 'commit',
    state: 'released',
  })
})
