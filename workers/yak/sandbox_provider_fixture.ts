// Exercise the provider and the published tools inside workerd. The namespace
// is a test Durable Object with RPC methods, never a container or live account.
import { released, spending, workbench } from './sandbox.ts'
import type { Space } from './directory.ts'
import { cloudflareProvider, type Sandboxes } from '@yaks/machine/cloudflare'
export let exercise = async (ns: Sandboxes) => {
  let id = crypto.randomUUID()
  let ref = { id }
  let provider = cloudflareProvider(ns, {
    env: () => Promise.resolve({ PROBE: 'invocation' }),
  })
  let { machine, cwd } = await provider.request!(ref)
  await machine.write('/workspace/pkg/app.wasm', '\x00asm\xff')
  let process = await machine.start('compile-provider')
  let running = await machine.look(process)
  let tail = await machine.tail(process, 2)
  await machine.kill(process, 'SIGTERM')
  let exited = await machine.look(process)
  // Reconstructing the provider must reach the same container and binary bytes.
  provider = cloudflareProvider(ns)
  let woke = await provider.wake(ref)
  let read = await woke.machine.read('/workspace/pkg/app.wasm')
  await ns.get(ns.idFromName(id)).writeFile(
    '/workspace/pkg/binary.wasm',
    btoa('\x00asm\xff'),
    { encoding: 'base64' },
  )
  let files = []
  for await (let file of provider.export(ref, ['pkg/binary.wasm'])) {
    files.push({ path: file.path, bytes: [...file.bytes] })
  }
  await provider.release(ref)
  await provider.release(ref)
  let gone = await (await provider.wake(ref)).machine.look(process)
  let rejected = []
  for (let request of [{ id, from: 'commit' }, { id, image: 'other-image' }]) {
    try {
      await provider.request!(request)
    } catch {
      rejected.push(true)
    }
  }

  let space = { eid: crypto.randomUUID(), slug: 'provider-lifecycle' } as Space
  let spend = spending()
  let host = await workbench(
    { SANDBOX: ns },
    space,
    'probe-person',
    spend,
    () => 0,
  )
  await host.machine.write('/workspace/held', 'held')
  let spent = await released({ SANDBOX: ns }, space, spend, () => 42001)
  let removed = false
  try {
    await (await host.provider.wake(host.ref)).machine.read('/workspace/held')
  } catch {
    removed = true
  }
  return {
    cwd,
    running,
    tail,
    exited,
    read,
    files,
    gone,
    rejected,
    spent,
    since: spend.since,
    removed,
  }
}
