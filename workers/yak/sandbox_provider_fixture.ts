// Exercise the provider and the published tools inside workerd. The namespace
// is a test Durable Object with RPC methods, never a container or live account.
import { released, spending, workbench } from './sandbox.ts'
import type { Workspaces } from './workspaces.ts'
import type { Space } from './directory.ts'
import { cloudflareProvider, type Sandboxes } from '@yaks/sandbox/cloudflare'
export let exercise = async (ns: Sandboxes, workspaces: Workspaces) => {
  let id = crypto.randomUUID()
  let ref = { id }
  let provider = cloudflareProvider(ns, {
    legacyRecreation: true,
    env: () => Promise.resolve({ PROBE: 'invocation' }),
  })
  let { workspace: machine, root: cwd } = await provider.request!(ref)
  await machine.write('/workspace/pkg/app.wasm', '\x00asm\xff')
  let process = await machine.start('compile-provider')
  let running = await machine.look(process)
  let tail = await machine.tail(process, 2)
  await machine.kill(process, 'SIGTERM')
  let exited = await machine.look(process)
  // Reconstructing the provider must reach the same container and binary bytes.
  provider = cloudflareProvider(ns, { legacyRecreation: true })
  let woke = await provider.connect(ref)
  let read = await woke.workspace.read('/workspace/pkg/app.wasm')
  await ns.get(ns.idFromName(id)).writeFile(
    '/workspace/pkg/binary.wasm',
    btoa('\x00asm\xff'),
    { encoding: 'base64' },
  )
  let files = []
  for await (let file of provider.export(ref, ['pkg/binary.wasm'])) {
    files.push({ path: file.path, bytes: [...file.bytes] })
  }
  await provider.dispose(ref)
  await provider.dispose(ref)
  let gone = await (await provider.connect(ref)).workspace.look(process)
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
    { SANDBOX: ns, WORKSPACES: workspaces },
    space,
    'probe-person',
    spend,
    () => 0,
  )
  await host.workspace.write('/workspace/held', 'held')
  let spent = await released(
    { SANDBOX: ns, WORKSPACES: workspaces },
    space,
    spend,
    () => 42001,
  )
  let removed = false
  try {
    await (await host.provider.connect(host.ref)).workspace.read(
      '/workspace/held',
    )
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
