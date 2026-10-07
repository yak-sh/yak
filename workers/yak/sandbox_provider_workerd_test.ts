// The provider crosses real Durable Object RPCs in workerd, without running
// a container. The published sandbox tools use that same provider end to end.
import { test } from '@yaks/testing'
import { assertEquals, assertStringIncludes } from '@std/assert'
import { connector, seed, workerd } from './probe.ts'

test('Cloudflare provider and sandbox tools preserve processes, binary artifacts and release in workerd', async () => {
  let response = await fetch(`${workerd().base}/__sandbox_provider/`)
  assertEquals(response.status, 200, await response.clone().text())
  let r = await response.json()
  assertEquals(r.cwd, '/workspace')
  assertEquals(r.running, { pid: 42 })
  assertEquals(r.tail, ['two', 'warning'])
  assertEquals(r.exited, { pid: 42, exit: { code: 0 } })
  assertEquals(r.read, '\x00asm\xff')
  assertEquals(r.files, [{
    path: 'pkg/binary.wasm',
    bytes: [0, 97, 115, 109, 255],
  }])
  assertEquals(r.gone, null)
  assertEquals(r.rejected, [true, true])
  assertEquals(r.spent, 43)
  assertEquals(r.since, null)
  assertEquals(r.removed, true)
  let k = workerd()
  let { cookie } = await seed(k, [{
    slug: 'providertools',
    apps: ['compiled'],
  }])
  let agent = connector(k, cookie)
  let args = { space: 'providertools' }
  await agent.tool('sandbox_write', {
    ...args,
    path: 'pkg/app.wasm',
    content: '\x00asm\xff',
  })
  let shell = await agent.answer('sandbox_shell', {
    ...args,
    command: 'compile',
    timeout: 0,
  })
  assertStringIncludes(shell.text, 'still running')
  let stopped = await agent.answer('sandbox_stop', { ...args, process: 'p' })
  assertStringIncludes(stopped.text, 'exited 0')
  let waited = await agent.answer('sandbox_wait', {
    ...args,
    process: 'p',
    timeout: 0,
  })
  assertStringIncludes(waited.text, 'exited 0')
  let read = await agent.answer('sandbox_read', {
    ...args,
    path: 'pkg/app.wasm',
  })
  assertEquals(read.text, '\x00asm\xff')
  let ship = await agent.answer('sandbox_ship', {
    ...args,
    app: 'compiled',
    paths: ['pkg/*.wasm'],
  })
  assertStringIncludes(ship.text, 'shipped 1 file')
  await agent.tool('app_deploy', { ...args, app: 'compiled' })
  let artifact = await k.at('providertools.yaks.app', '/compiled/app.wasm')
  assertEquals(artifact.status, 200, await artifact.clone().text())
  assertEquals([...new Uint8Array(await artifact.arrayBuffer())], [
    0,
    97,
    115,
    109,
    195,
    191,
  ])
})
