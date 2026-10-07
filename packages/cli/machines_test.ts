import { addressOf } from '@yaks/blob'
// Machine providers are composed at the CLI boundary; provisioning is still
// lazy, and the files a commit supplies come from the graph's object store.
import { equal, test } from '@yaks/testing'
import { compose } from './host.ts'
import { machineCapabilities } from './machines.ts'
import { index } from '@yaks/git'

test('CLI lends lazy process machines, prepares graph commits, and detaches existing machines', async () => {
  let dir = await Deno.makeTempDir()
  let host = await compose({
    db: ':memory:',
    plugins: [
      '@yaks/kernel',
      '@yaks/key',
      '@yaks/edge',
      '@yaks/git',
      '@yaks/process',
      '@yaks/machine',
    ],
  }, ['graph'])
  try {
    // Composition must preserve the provider's discovery boundary during
    // preparation: its data directory can itself be inside a repository.
    let enclosing = await new Deno.Command('git', {
      args: ['init', '-q', dir],
      stderr: 'piped',
    }).output()
    equal(enclosing.code, 0)
    let git = index(host.graph, host.artifacts)
    let bytes = new TextEncoder().encode('from the graph\n')
    let sha = await addressOf(bytes)
    await host.artifacts.put(sha, bytes)
    let tree = await git.files({ 'hello.txt': sha })
    let from = await git.commit({
      tree,
      author: { name: 'A', email: 'a@example.com', at: 0 },
      committer: { name: 'A', email: 'a@example.com', at: 0 },
      message: 'seed',
    })
    let capabilities = await machineCapabilities(host, {
      machines: {
        defaultProvider: 'process',
        providers: {
          process: { use: '@yaks/process', with: { dir: dir + '/machines' } },
        },
      },
    }, ':memory:')
    let source = capabilities.providers.process
    let loan = await source.request!({ id: 'test-machine', from: from.oid })
    equal(await loan.machine.read('hello.txt'), 'from the graph\n')
    let repeat = await source.wake({ id: 'test-machine' })
    equal(await repeat.machine.read('hello.txt'), 'from the graph\n')
    await source.release({ id: 'test-machine' })
    let attached = await source.attach!({ id: 'meta', address: dir })
    await attached.machine.write('keep', 'kept')
    await source.release({ id: 'meta', address: dir })
    equal(await Deno.readTextFile(dir + '/keep'), 'kept')
  } finally {
    await host.close()
    await Deno.remove(dir, { recursive: true })
  }
})
