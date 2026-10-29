import { test, throws } from '@yaks/testing'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { pveClones } from './pve.ts'

let vocab = loadVocab([])
let g = graph({ storage: ram(vocab), vocab })

test('PVE has no implicit template, storage or VMID pool', async () => {
  let transport = {
    execute: () => Promise.reject(new Error('must not execute')),
  }
  let options = {
    transport,
    state: '/private/state',
    template: 900,
    storage: 'pool',
    vmidRange: [1000, 1001] as const,
  }
  await throws(() => pveClones(g, { ...options, storage: '' }))
  await throws(() => pveClones(g, { ...options, vmidRange: [900, 1000] }))
  await throws(() => pveClones(g, { ...options, state: '/state/../other' }))
  await throws(() =>
    pveClones(g, options).connect({ id: 'sandbox', address: 'wrong' })
  )
})
