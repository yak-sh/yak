// A Cloudflare namespace chooses its deployed image. Unsupported request
// inputs must fail before any RPC can create a container with the wrong data.
import { equal, test, throws } from '@yaks/testing'
import { type Bundle, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { kernelDoc } from '@yaks/kernel'
import { sandboxDoc } from './vocab.ts'
import {
  type Box,
  cloudflareProvider,
  HELD,
  hold,
  lending,
  slept,
} from './cloudflare.ts'

test('Cloudflare refuses unsupported provenance, images and existing addresses without RPC', async () => {
  let calls = 0
  let provider = cloudflareProvider({
    idFromName: (name) => name,
    get: () => {
      calls++
      return {} as Box
    },
  })
  for (
    let request of [{ id: 'a', from: 'commit' }, { id: 'a', image: 'image' }]
  ) {
    let refused = false
    try {
      await provider.request!(request)
    } catch {
      refused = true
    }
    equal(refused, true)
  }
  let refused = false
  try {
    await provider.connect({ id: 'a', address: 'remote' })
  } catch {
    refused = true
  }
  equal(refused, true)
  equal(calls, 0)
})

// Test storage implements the same durable callback seam without container I/O.
test('Cloudflare lifecycle refuses missing storage and never recreates disposed or lost storage', async () => {
  let state: 'provisioning' | 'ready' | 'disposing' | 'released' | undefined
  let status = 'healthy'
  let creates = 0
  let destroys = 0
  let box = {
    mkdir: () => {
      creates++
      return Promise.resolve()
    },
    getState: () => Promise.resolve({ status }),
    destroy: () => {
      destroys++
      return Promise.resolve()
    },
  } as unknown as Box
  let ns = { idFromName: (id: string) => id, get: () => box }
  let provider = cloudflareProvider(ns, {
    lifecycle: {
      locked: async (_id, act) =>
        await act({
          state,
          save: (next) => {
            state = next
            return Promise.resolve()
          },
        }),
    },
  })
  let ref = { id: 'durable' }
  await throws(() => cloudflareProvider(ns).request!(ref), 'lifecycle storage')
  await throws(() => provider.connect(ref), 'not ready')
  await provider.request!(ref)
  let stale = await provider.connect(ref)
  equal((await provider.connect(ref)).root, '/workspace')
  await provider.request!(ref)
  equal(creates, 1)
  status = 'stopped'
  await throws(() => provider.connect(ref), 'refusing recreation')
  await throws(() => provider.request!(ref), 'refusing recreation')
  equal(creates, 1)
  await provider.dispose(ref)
  await provider.dispose(ref)
  equal(destroys, 1)
  await throws(() => stale.workspace.read('file'), 'disposed')
  await throws(() => stale.workspace.start('echo recreate'), 'disposed')
  await throws(() => provider.exec(ref, 'true'), 'disposed')
  await throws(async () => {
    for await (
      let _ of provider.export(ref, ['file'])
    ) { /* must refuse before yielding */ }
  }, 'disposed')
  await throws(() => provider.request!(ref), 'disposed')
  await throws(() => provider.connect(ref), 'disposed')
  equal(creates, 1)
})

// Who is awake in a group is its `lent` rows, in whatever store keeps them.
let [GROUP, OTHER, ADA, BOB] = ['a', 'b', 'c', 'd'].map((n) =>
  `a0000000-0000-4000-8000-00000000000${n}`
)
let lend = async () => {
  let vocab = loadVocab([kernelDoc, sandboxDoc])
  let store = graph({ storage: ram(vocab), vocab })
  await store.apply(
    [GROUP, OTHER, ADA, BOB].map((eid) => ({ entity: { eid }, opened: {} })),
  )
  return store
}

test('a group holds as many sandboxes awake as it allows, and each sleeps after its hold', async () => {
  let store = await lend(), now = Date.now()
  equal(await hold(store, GROUP, ADA, 1, now), { held: true })
  equal(await hold(store, GROUP, BOB, 1, now), { held: false, awake: 1 })
  equal(await hold(store, GROUP, BOB, 2, now), { held: true })
  equal(await hold(store, OTHER, BOB, 1, now), { held: true })
  let later = now + (HELD + 1) * 1000
  equal(await hold(store, GROUP, ADA, 1, later), { held: true })
  await slept(store, GROUP, ADA)
  equal(await hold(store, GROUP, BOB, 1, now), { held: true })
  // Asleep, a sandbox is still lent: the group's erasure finds it.
  equal((await lending(store, GROUP)).map((l) => l.to).sort(), [ADA, BOB])
})

test('a hold is written again only once half of it is spent', async () => {
  let store = await lend(), now = Date.now(), writes = 0
  let counted = {
    read: store.read,
    apply: (b: Bundle[]) => (writes++, store.apply(b)),
  }
  await hold(counted, GROUP, ADA, 1, now)
  await hold(counted, GROUP, ADA, 1, now + (HELD / 2 - 1) * 1000)
  equal(writes, 1)
  await hold(counted, GROUP, ADA, 1, now + HELD / 2 * 1000)
  equal(writes, 2)
})
