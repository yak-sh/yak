import { addressOf } from '@yaks/blob'
// Machine providers are composed at the CLI boundary; provisioning is still
// lazy, and the files a commit supplies come from the graph's object store.
import { equal, test, throws } from '@yaks/testing'
import { compose } from './host.ts'
import { machineCapabilities } from './machines.ts'
import { index } from '@yaks/git'
import type { Host } from '@yaks/host'

let checkLoading = async () => {
  let loaded: unknown[] = []
  let host = {
    report: (event: unknown) => {
      loaded.push(event)
    },
  } as Host
  let use = 'data:text/javascript,' + encodeURIComponent(`
    export let provider = (host, options) => {
      host.report(options.name)
      return {
        ...(options.sandbox ? { request: async () => ({}) } : {}),
        wake: async () => ({}),
        release: async () => {},
        export: async function* () {},
      }
    }
  `)
  let machines = machineCapabilities(host, {
    machines: {
      defaultProvider: 'sandbox',
      providers: {
        sandbox: { use, with: { name: 'sandbox', sandbox: true } },
        attached: { use, with: { name: 'attached' } },
        unused: {
          use: 'data:text/javascript,throw new Error("not requested")',
        },
      },
    },
  }, ':memory:')
  equal(loaded, [])
  let first = machines.provider('sandbox')
  equal(machines.provider('sandbox') === first, true)
  let source = await first
  equal(await machines.provider('sandbox') === source, true)
  equal(loaded, ['sandbox'])
  equal((await machines.provider('attached'))?.request, undefined)
  equal(await machines.provider('missing'), undefined)
  equal(await machines.provider('constructor'), undefined)
  equal(loaded, ['sandbox', 'attached'])
}

test('CLI lends lazy process machines, prepares graph commits, and detaches existing machines', async () => {
  await checkLoading()
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
    let capabilities = machineCapabilities(host, {
      machines: {
        defaultProvider: 'process',
        providers: {
          // Looked at every 5 ms, so preparing a commit costs the git it
          // runs rather than the default tenth of a second per look.
          process: {
            use: '@yaks/process',
            with: { dir: dir + '/machines', poll: 5 },
          },
        },
      },
    }, ':memory:')
    let source = (await capabilities.provider('process'))!
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

// Exercise the same lazy home binding used by HTTP native sessions. In
// particular, composition must not replace provisioning with the SQL fallback.
let nativeFixerProbe = await (async () => {
  let dir = await Deno.makeTempDir()
  let repo = dir + '/repo'
  let git = async (...args: string[]) => {
    let out = await new Deno.Command('git', {
      cwd: repo,
      args,
      stdout: 'piped',
      stderr: 'piped',
    }).output()
    if (out.code) throw new Error(new TextDecoder().decode(out.stderr))
    return new TextDecoder().decode(out.stdout).trim()
  }
  await Deno.mkdir(repo)
  await git('init', '-q', '-b', 'main')
  await Deno.writeTextFile(repo + '/file', 'committed\n')
  await git('add', '.')
  await git(
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.com',
    'commit',
    '-qm',
    'seed',
  )
  await Deno.writeTextFile(repo + '/file', 'uncommitted\n')
  await Deno.writeTextFile(repo + '/untracked', 'not shared\n')
  let host = await compose({
    db: ':memory:',
    plugins: [
      '@yaks/kernel',
      '@yaks/key',
      '@yaks/edge',
      '@yaks/git',
      '@yaks/process',
      '@yaks/machine',
      '@yaks/session',
      '@yaks/harness',
      '@yaks/heal',
      {
        use: '@yaks/spawn',
        with: { cwd: repo, worktrees: dir + '/worktrees' },
      },
    ],
    machines: {
      // A remote default is not a local attachment. Provisioning must select
      // the explicitly configured process provider, even under another name.
      defaultProvider: 'remote',
      providers: {
        remote: {
          use: 'data:text/javascript,throw new Error("remote must stay lazy")',
        },
        local: { use: '@yaks/process', with: { dir: dir + '/machines' } },
      },
    },
  }, ['graph'])
  try {
    let { machines } = await import('../harness/session_machines.ts')
    let binding = machines(host.graph, host.machines)
    let [first, second, explicit, regular, managed] = Array.from(
      { length: 5 },
      () => crypto.randomUUID(),
    )
    await host.graph.apply([
      ...[first, second, explicit].map((eid) => ({
        entity: { eid },
        session: {},
        fixer: {},
        native: {},
      })),
      { entity: { eid: regular }, session: {}, native: {} },
      { entity: { eid: managed }, session: {}, fixer: {} },
    ])
    let regularHome = await host.machines!.resolveHome!(regular)
    let managedHome = await host.machines!.resolveHome!(managed)
    let firstCwd = await binding.cwd(first)
    let secondCwd = await binding.cwd(second)
    let committed = await (await binding.machine(first)).read('file')
    let untracked = await Deno.stat(firstCwd + '/untracked').then(
      () => true,
      () => false,
    )
    let original = await Deno.readTextFile(repo + '/file')
    let [owner] = await host.graph.get([first])
    let home = owner.home as { machine: string; cwd: string }
    let [record] = await host.graph.get([home.machine])
    let machine = record.machine as {
      provider: string
      address: string
      state: string
    }
    await (await binding.machine(first)).write('file', 'fixer edits\n')
    // Recreate both host capability and binding to rule out process-local reuse.
    let fresh = machineCapabilities(host, host.config, ':memory:')
    let reusedHome = await fresh.resolveHome!(first)
    let reusedCwd = await machines(host.graph, fresh).cwd(first)
    let reusedEdits = await Deno.readTextFile(firstCwd + '/file')
    let branch = await new Deno.Command('git', {
      cwd: firstCwd,
      args: ['branch', '--show-current'],
      stdout: 'piped',
    }).output()
    let branchName = new TextDecoder().decode(branch.stdout).trim()
    await host.graph.apply([{
      entity: { eid: explicit },
      home: { machine: home.machine, cwd: firstCwd },
    }])
    let explicitCwd = await binding.cwd(explicit)
    let explicitWorktree = await Deno.stat(dir + '/worktrees/' + explicit).then(
      () => true,
      () => false,
    )
    // A host with only a remote provider must fail, not label a local path as remote.
    let remoteOnly = machineCapabilities(host, {
      ...host.config,
      machines: {
        defaultProvider: 'remote',
        providers: { remote: { use: 'remote' } },
      },
    }, ':memory:')
    let remoteHome = await remoteOnly.resolveHome!(second).then(
      (value) => () => value,
      (error) => () => {
        throw error
      },
    )
    let local = machineCapabilities(host, {
      ...host.config,
      machines: {
        defaultProvider: 'local',
        providers: {
          local: { use: '@yaks/process', with: { dir: dir + '/regular' } },
        },
      },
    }, ':memory:')
    let ordinary = machines(host.graph, local)
    let regularCwd = await ordinary.cwd(regular)
    let regularInProvider = regularCwd?.startsWith(dir + '/regular/')
    let regularWorktree = await Deno.stat(dir + '/worktrees/' + regular).then(
      () => true,
      () => false,
    )
    await ordinary.release(regular)
    await binding.release(second)
    let releasedFile = await Deno.readTextFile(
      dir + '/worktrees/' + second + '/file',
    )
    let remainingEdits = await Deno.readTextFile(firstCwd + '/file')
    return {
      dir,
      first,
      second,
      regularHome,
      managedHome,
      firstCwd,
      secondCwd,
      committed,
      untracked,
      original,
      home,
      machine,
      reusedHome,
      reusedCwd,
      reusedEdits,
      branchName,
      explicitCwd,
      explicitWorktree,
      remoteHome,
      regularInProvider,
      regularWorktree,
      releasedFile,
      remainingEdits,
    }
  } finally {
    await host.close()
    // Test-owned repository and checkouts only; production never removes them.
    await Deno.remove(dir, { recursive: true })
  }
})()

test('CLI native fixers get distinct reusable committed worktrees without changing explicit homes', async () => {
  let probe = nativeFixerProbe
  equal(probe.regularHome, undefined)
  equal(probe.managedHome, undefined)
  equal(probe.firstCwd, probe.dir + '/worktrees/' + probe.first)
  equal(probe.secondCwd, probe.dir + '/worktrees/' + probe.second)
  equal(probe.committed, 'committed\n')
  equal(probe.untracked, false)
  equal(probe.original, 'uncommitted\n')
  equal(probe.machine.provider, 'local')
  equal(probe.machine.address, probe.firstCwd)
  equal(probe.machine.state, 'running')
  equal(probe.reusedHome, probe.home)
  equal(probe.reusedCwd, probe.firstCwd)
  equal(probe.reusedEdits, 'fixer edits\n')
  equal(probe.branchName, 'session-' + probe.first)
  equal(probe.explicitCwd, probe.firstCwd)
  equal(probe.explicitWorktree, false)
  await throws(probe.remoteHome, 'configured process provider')
  equal(probe.regularInProvider, true)
  equal(probe.regularWorktree, false)
  equal(probe.releasedFile, 'committed\n')
  equal(probe.remainingEdits, 'fixer edits\n')
})
