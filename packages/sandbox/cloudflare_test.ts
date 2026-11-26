// A Cloudflare namespace chooses its deployed image. Unsupported request
// inputs must fail before any RPC can create a container with the wrong data.
import { clock, equal, test, throws } from '@yaks/testing'
import { type Bundle, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { kernelDoc } from '@yaks/kernel'
import { sandboxDoc } from './vocab.ts'
import { sandboxes } from './testing.ts'
import {
  admitted,
  type Box,
  cloudflareProvider,
  HELD,
  hold,
  lending,
  POOL_BUSY,
  processStatus,
  slept,
} from './cloudflare.ts'

let full = () =>
  new Error(
    'Maximum number of running container instances exceeded. Try again later, or try configuring a higher value for max_instances',
  )

test('a stalled process status read is cancelled before a fresh read', async () => {
  let time = clock()
  let requests: Request[] = []
  let said = processStatus(new Request('http://box/api/process/a'), (req) => {
    requests.push(req)
    if (requests.length == 2) {
      return Promise.resolve(Response.json({ status: 'running' }))
    }
    return new Promise((_, fail) => {
      req.signal.addEventListener('abort', () => fail(req.signal.reason), {
        once: true,
      })
    })
  }, time)
  await time.advance(5_000)
  equal(await (await said).json(), { status: 'running' })
  equal(requests.map((req) => req.signal.aborted), [true, false])
})

test('a proxy 500 is retried while a sandbox API error is returned', async () => {
  let req = new Request('http://box/api/process/a')
  let responses = [
    new Response('Container suddenly disconnected, try again', { status: 500 }),
    Response.json({ code: 'PROCESS_NOT_FOUND' }, { status: 404 }),
  ]
  let answer = await processStatus(
    req,
    () => Promise.resolve(responses.shift()!),
  )
  equal(responses.length, 0)
  equal(answer.status, 404)
  equal(await answer.json(), { code: 'PROCESS_NOT_FOUND' })
})

test('a full pool waits for a slot before the workspace operation runs', async () => {
  let time = clock()
  let free = false
  let commands = 0
  let done = admitted(() => {
    if (!free) throw new Error('startup failed', { cause: full() })
  }, time).then(() => commands++)
  await time.advance(2_000)
  equal(commands, 0)
  free = true
  await time.advance(2_000)
  await done
  equal(commands, 1)
})

test('a pool that stays full answers with a retryable busy message', async () => {
  let time = clock()
  let done = throws(
    () =>
      admitted(() => {
        throw full()
      }, time),
    POOL_BUSY,
  )
  await time.advance(90_000)
  await done
  equal(time.pending(), 0)
})

test('an unrelated startup failure is passed through without waiting', async () => {
  let time = clock()
  await throws(
    () =>
      admitted(() => {
        throw new Error('missing sandbox image')
      }, time),
    'missing sandbox image',
  )
  equal(time.pending(), 0)
})

test('a retried start reads its process after an acknowledgement is lost', async () => {
  let command = 'write once'
  let sandbox = sandboxes()
  let ns = sandbox.WORKBENCH
  let provider = cloudflareProvider({
    ...ns,
    get: (name) => {
      let box = ns.get(String(name))
      return {
        ...box,
        startProcess: async (...args) => {
          await box.startProcess(...args)
          throw new Error('lost connection')
        },
      }
    },
  }, {
    ephemeral: true,
    retry: async (send) => {
      try {
        return await send()
      } catch {
        return await send()
      }
    },
  })
  let { workspace } = await provider.connect({ id: 'workbench' })
  equal(await workspace.start(command, undefined, 'ask'), 'ask')
  equal(sandbox.ran, [command])
})

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
    trash: async (_ref, box) => {
      await box.destroy()
    },
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

test('Cloudflare disposal without recoverable trash leaves the writable container intact', async () => {
  let destroyed = false
  let ns = {
    idFromName: (id: string) => id,
    get: () => ({
      destroy: () => {
        destroyed = true
        return Promise.resolve()
      },
    } as unknown as Box),
  }
  await throws(
    () => cloudflareProvider(ns, { ephemeral: true }).dispose({ id: 'draft' }),
    'recoverable trash',
  )
  equal(destroyed, false)
})

test('Cloudflare prepares retained storage before the first workspace read', async () => {
  let files = new Map<string, string>()
  let box = {
    readFile: (path: string) => Promise.resolve({ content: files.get(path) }),
  } as unknown as Box
  let provider = cloudflareProvider(
    { idFromName: (id) => id, get: () => box },
    {
      ephemeral: true,
      prepare: () => {
        files.set('draft', 'retained edit')
        return Promise.resolve()
      },
    },
  )
  equal(
    await (await provider.connect({ id: 'draft' })).workspace.read('draft'),
    'retained edit',
  )
})
