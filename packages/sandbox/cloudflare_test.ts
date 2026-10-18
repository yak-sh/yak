// A Cloudflare namespace chooses its deployed image. Unsupported request
// inputs must fail before any RPC can create a container with the wrong data.
import { equal, test, throws } from '@yaks/testing'
import { type Box, cloudflareProvider } from './cloudflare.ts'

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

// The SDK door keeps binary files and retries a write after delivering it,
// matching the lost-reply case without starting a container in a unit test.
let transfers = (
  bytes = new Uint8Array([0, 128, 255, 10]),
  env?: () => Promise<Record<string, string>>,
) => {
  let files = new Map<string, Uint8Array>()
  let restored: Uint8Array | undefined
  let reads = 0
  let fail = ''
  let repeat = false
  let repeated = false
  let box = {
    exec(command: string) {
      let stdout = ''
      let paths = [...command.matchAll(/'([^']+)'/g)].map((m) => m[1])
      if (command.startsWith('tar ')) {
        files.set(paths[1], bytes)
        stdout = String(bytes.length)
      } else if (command.includes('count=1')) {
        reads++
        let start = Number(command.match(/skip=(\d+)/)![1]) * 256 * 1024
        stdout = btoa(String.fromCharCode(...bytes.subarray(start)))
      } else if (command.startsWith(': >')) {
        files.set(paths[0], new Uint8Array())
      } else if (command.startsWith('dd ')) {
        let offset = Number(command.match(/seek=(\d+)/)![1])
        let part = files.get(paths[0])!
        let previous = files.get(paths[1])!
        let written = new Uint8Array(
          Math.max(previous.length, offset + part.length),
        )
        written.set(previous)
        written.set(part, offset)
        files.set(paths[1], written)
        if (repeat && !repeated) {
          repeated = true
          throw new Error('RPC reply lost')
        }
      } else if (command.startsWith('python3 ')) {
        restored = files.get([...files.keys()].find((p) => p.endsWith('.tar'))!)
      } else if (command.startsWith('rm ')) {
        paths.forEach((path) => files.delete(path))
      }
      return Promise.resolve({
        stdout,
        stderr: fail && command.includes(fail) ? 'archive refused' : '',
        exitCode: fail && command.includes(fail) ? 1 : 0,
      })
    },
    writeFile(path: string, content: string, opts?: { encoding?: string }) {
      equal(opts?.encoding, 'base64')
      files.set(path, Uint8Array.from(atob(content), (c) => c.charCodeAt(0)))
    },
  } as Box
  let provider = cloudflareProvider({
    idFromName: (name) => name,
    get: () => box,
  }, {
    env,
    legacyRecreation: true,
    retry: async (send) => {
      try {
        return await send()
      } catch (error) {
        if (!(error instanceof Error) || error.message !== 'RPC reply lost') {
          throw error
        }
        return await send()
      }
    },
  })
  return {
    provider,
    files,
    get reads() {
      return reads
    },
    get restored() {
      return restored
    },
    fail: (command: string) => fail = command,
    repeat: () => repeat = true,
  }
}

test('Cloudflare streams binary archives on demand and disposes temporary files', async () => {
  let fixture = transfers(undefined, () => {
    throw new Error('an archive must not ask for invocation credentials')
  })
  let archive = await fixture.provider.archive({ id: 'source' })
  equal(archive.size, 4)
  equal(fixture.reads, 0)
  let reader = archive.body.getReader()
  equal((await reader.read()).value, new Uint8Array([0, 128, 255, 10]))
  equal((await reader.read()).done, true)
  await archive.dispose()
  equal(fixture.files.size, 0)
})

test('Cloudflare restores binary streams without duplicating retried writes', async () => {
  let fixture = transfers(undefined, () => {
    throw new Error('a restore must not ask for invocation credentials')
  })
  fixture.repeat()
  await fixture.provider.restore(
    { id: 'target' },
    new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([0, 128]))
        controller.enqueue(new Uint8Array([255, 10]))
        controller.close()
      },
    }),
  )
  equal(fixture.restored, new Uint8Array([0, 128, 255, 10]))
  equal(fixture.files.size, 0)
})

test('Cloudflare archive cancellation and failed reads remove temporary files', async () => {
  let fixture = transfers()
  let archive = await fixture.provider.archive({ id: 'source' })
  await archive.body.cancel()
  equal(fixture.files.size, 0)
  archive = await fixture.provider.archive({ id: 'source' })
  fixture.fail('count=1')
  await throws(() => archive.body.getReader().read(), 'archive refused')
  equal(fixture.files.size, 0)
})

test('Cloudflare reports refused archive extraction and cleans the transfer', async () => {
  let fixture = transfers()
  fixture.fail('python3')
  await throws(
    () =>
      fixture.provider.restore(
        { id: 'target' },
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array([0, 128, 255, 10]))
            controller.close()
          },
        }),
      ),
    'archive refused',
  )
  equal(fixture.files.size, 0)
})

test('Cloudflare observes active containers and returns detached process data', async () => {
  let state = 'healthy'
  let box = {
    getState: () => Promise.resolve({ status: state }),
    listProcesses: () =>
      Promise.resolve([
        { id: 'compile', status: 'running', pid: 7, kill: () => {} },
        { id: 'finished', status: 'completed', exitCode: 0 },
      ]),
  } as unknown as Box
  let provider = cloudflareProvider({
    idFromName: (name) => name,
    get: () => box,
  }, { legacyRecreation: true })
  equal(await provider.active({ id: 'source' }), true)
  state = 'stopped'
  equal(await provider.active({ id: 'source' }), false)
  equal(await provider.processes({ id: 'source' }), [
    { id: 'compile', status: 'running', pid: 7 },
    { id: 'finished', status: 'completed', exitCode: 0 },
  ])
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
  await throws(() => provider.archive(ref), 'disposed')
  await throws(() => provider.processes(ref), 'disposed')
  await throws(() => provider.active(ref), 'disposed')
  await throws(async () => {
    for await (
      let _ of provider.export(ref, ['file'])
    ) { /* must refuse before yielding */ }
  }, 'disposed')
  await throws(() => provider.request!(ref), 'disposed')
  await throws(() => provider.connect(ref), 'disposed')
  equal(creates, 1)
})
