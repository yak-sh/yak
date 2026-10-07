// Provider-backed homes provision only when commands/files need them and keep
// their durable identity across retries, workers and migrated attachments.
import { equal, test } from '@yaks/testing'
import { type Comp, derivedEid, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { docs } from './vocab.ts'
import { machineDoc } from '@yaks/machine/vocab'
import { docs as sessionDocs } from '@yaks/session/vocab'
import { gitDoc } from '@yaks/git/vocab'
import type { Machine, MachineProvider, MachineRef } from '@yaks/machine'
import { homeAt, machines, sessionCwd } from './session_machines.ts'

let fixture = async () => {
  let vocab = loadVocab([...docs, machineDoc, ...sessionDocs, gitDoc])
  let g = graph({ storage: ram(vocab), vocab })
  let requests: unknown[] = []
  let wakes: MachineRef[] = []
  let releases: MachineRef[] = []
  let exports: string[][] = []
  let m: Machine = {
    start: () => Promise.resolve('process'),
    look: () => Promise.resolve({ exit: { code: 0 } }),
    tail: () => Promise.resolve([]),
    kill: () => Promise.resolve(),
    read: () => Promise.resolve('text'),
    write: () => Promise.resolve(),
  }
  let provider: MachineProvider = {
    request: (r) => {
      requests.push(r)
      return Promise.resolve({ machine: m, cwd: '/checkout' })
    },
    wake: (r) => {
      wakes.push(r)
      return Promise.resolve({ machine: m, cwd: r.address ?? '/checkout' })
    },
    attach: () => Promise.resolve({ machine: m, cwd: '/attached' }),
    release: (r) => {
      releases.push(r)
      return Promise.resolve()
    },
    export: async function* (_, paths) {
      exports.push(paths)
      for (let path of paths) yield { path, bytes: new Uint8Array([0, 255]) }
    },
  }
  let configured = { providers: { fake: provider }, defaultProvider: 'fake' }
  await g.apply([{ entity: { eid: 'parent' }, session: {} }])
  return {
    g,
    m,
    configured,
    binding: machines(g, configured),
    requests,
    wakes,
    releases,
    exports,
  }
}

test('machine home is lazy and first need records one stable sandbox', async () => {
  let f = await fixture()
  equal(homeAt(), {})
  equal(homeAt('shared', '/sub'), { machine: 'shared', cwd: '/sub' })
  equal(f.requests, [])
  equal(await sessionCwd(f.g, 'parent'), undefined)
  let [a, b] = await Promise.all([
    f.binding.machine('parent'),
    f.binding.cwd('parent'),
  ])
  equal(a, f.m)
  equal(b, '/checkout')
  equal(f.requests, [{ id: derivedEid('session-machine|parent') }])
  equal((await f.g.get(['parent']))[0].home, {
    machine: derivedEid('session-machine|parent'),
    cwd: '/checkout',
  })
  equal(
    ((await f.g.get([derivedEid('session-machine|parent')]))[0].machine as Comp)
      .state,
    'running',
  )
  equal(await machines(f.g, f.configured).cwd('parent'), '/checkout')
  equal(f.requests.length, 1)
})

test('interrupted machine request repeats the same durable provider id', async () => {
  let f = await fixture()
  let request = f.configured.providers.fake.request!
  let failed = false
  f.configured.providers.fake.request = (r) => {
    if (!failed) {
      failed = true
      return Promise.reject(new Error('interrupted'))
    }
    return request(r)
  }
  try {
    await f.binding.machine('parent')
    throw new Error('expected request failure')
  } catch (error) {
    equal((error as Error).message, 'interrupted')
  }
  equal(
    ((await f.g.get([derivedEid('session-machine|parent')]))[0].machine as Comp)
      .state,
    'requested',
  )
  await machines(f.g, f.configured).machine('parent')
  equal(f.requests, [{ id: derivedEid('session-machine|parent') }])
})

test('migrated running homes wake their attached machine and retain their cwd', async () => {
  let f = await fixture()
  await f.g.apply([
    {
      entity: { eid: 'existing' },
      machine: {
        provider: 'fake',
        address: '/old-worktree',
        state: 'running',
      },
    },
    {
      entity: { eid: 'parent' },
      home: { machine: 'existing', cwd: '/old-worktree/sub' },
    },
  ])
  equal(await f.binding.cwd('parent'), '/old-worktree/sub')
  equal(f.requests, [])
  equal(f.wakes, [{ id: 'existing', address: '/old-worktree' }])
})

test('task children request a new machine from the parent graph commit lazily', async () => {
  let f = await fixture()
  await f.g.apply([
    { entity: { eid: 'commit' }, gitobj: { type: 'commit', size: 0 } },
    {
      entity: { eid: 'seed' },
      machine: {
        provider: 'fake',
        from: 'commit',
        state: 'running',
      },
    },
    { entity: { eid: 'parent' }, home: { machine: 'seed', cwd: '/checkout' } },
  ])
  let args = await f.binding.limits.taskDefaults!('parent', 'child')
  let prepared = await f.binding.limits.prepareChild!({
    parent: 'parent',
    child: 'child',
    args,
  })
  equal(prepared.home, { machine: derivedEid('session-machine|child') })
  equal(f.requests, [])
  await f.g.apply([{ entity: { eid: 'child' }, session: {}, ...prepared }])
  await f.binding.machine('child')
  equal(f.requests, [{
    id: derivedEid('session-machine|child'),
    from: 'commit',
  }])
  equal(
    (await f.binding.limits.prepareChild!({
      parent: 'parent',
      child: 'fork',
      args: {},
    })).home,
    {
      machine: 'seed',
      cwd: '/checkout',
    },
  )
  equal(
    (await f.binding.limits.prepareChild!({
      parent: 'parent',
      child: 'fork',
      args: { cwd: 'sub' },
    })).home,
    {
      machine: 'seed',
      cwd: '/checkout/sub',
    },
  )
})

test('releasing a shared machine waits for borrowers and is repeatable', async () => {
  let f = await fixture()
  await f.binding.machine('parent')
  let parent = (await f.g.get(['parent']))[0]
  await f.g.apply([{
    entity: { eid: 'borrower' },
    session: {},
    home: parent.home,
  }])
  await f.binding.release('parent')
  equal(f.releases, [])
  await f.g.apply([{ entity: { eid: 'borrower' }, session: { ended: true } }])
  await f.binding.release('parent')
  await f.binding.release('parent')
  equal(f.releases, [{ id: derivedEid('session-machine|parent') }])
  equal(
    ((await f.g.get([derivedEid('session-machine|parent')]))[0].machine as Comp)
      .state,
    'released',
  )
})

test('export resolves session paths within provider root and keeps binary bytes', async () => {
  let f = await fixture()
  await f.binding.machine('parent')
  await f.g.apply([{
    entity: { eid: 'parent' },
    home: { cwd: '/checkout/sub' },
  }])
  let files = []
  for await (
    let file of f.binding.files('parent', ['image.png', '/checkout/root.bin'])
  ) {
    files.push(file)
  }
  equal(f.exports, [['sub/image.png', 'root.bin']])
  equal(files, [
    { path: 'sub/image.png', bytes: new Uint8Array([0, 255]) },
    { path: 'root.bin', bytes: new Uint8Array([0, 255]) },
  ])
  let failed = false
  try {
    for await (
      let _ of f.binding.files('parent', ['../../outside'])
    ) { /* consume */ }
  } catch {
    failed = true
  }
  equal(failed, true)
  equal(f.exports.length, 1)
})

test('release failure remains owed and another binding can retry it', async () => {
  let f = await fixture()
  await f.binding.machine('parent')
  let release = f.configured.providers.fake.release
  let once = false
  f.configured.providers.fake.release = (ref) => {
    if (!once) {
      once = true
      return Promise.reject(new Error('temporary provider failure'))
    }
    return release(ref)
  }
  try {
    await f.binding.release('parent')
    throw new Error('expected release failure')
  } catch (error) {
    equal((error as Error).message, 'temporary provider failure')
  }
  equal(
    ((await f.g.get([derivedEid('session-machine|parent')]))[0].machine as Comp)
      .state,
    'running',
  )
  await machines(f.g, f.configured).release('parent')
  equal(f.releases, [{ id: derivedEid('session-machine|parent') }])
  equal(
    ((await f.g.get([derivedEid('session-machine|parent')]))[0].machine as Comp)
      .state,
    'released',
  )
})

test('a resumed released sandbox is requested again instead of waking a deleted directory', async () => {
  let f = await fixture()
  await f.binding.machine('parent')
  await f.binding.release('parent')
  let wakeCount = f.wakes.length
  await machines(f.g, f.configured).machine('parent')
  equal(f.requests, [
    { id: derivedEid('session-machine|parent') },
    { id: derivedEid('session-machine|parent') },
  ])
  equal(f.wakes.length, wakeCount)
  equal(
    ((await f.g.get([derivedEid('session-machine|parent')]))[0].machine as Comp)
      .state,
    'running',
  )
})

test('prompt child shares the unprovisioned parent machine intention', async () => {
  let f = await fixture()
  let prepared = await f.binding.limits.prepareChild!({
    parent: 'parent',
    child: 'fork',
    args: {},
  })
  equal(prepared.home, { machine: derivedEid('session-machine|parent') })
  equal(f.requests, [])
  await f.g.apply([{ entity: { eid: 'fork' }, session: {}, ...prepared }])
  await machines(f.g, f.configured).machine('fork')
  await f.binding.machine('parent')
  equal(f.requests, [{ id: derivedEid('session-machine|parent') }])
})

test('a host boundary resolves an in-flight home before its first file needs a default sandbox', async () => {
  let f = await fixture()
  let translated = 0
  let binding = machines(f.g, {
    ...f.configured,
    resolveHome: async (session) => {
      equal(session, 'parent')
      translated++
      await f.g.apply([{
        entity: { eid: 'old-home-machine' },
        machine: {
          provider: 'fake',
          address: '/old-worktree',
          state: 'running',
        },
      }])
      return { machine: 'old-home-machine', cwd: '/old-worktree/sub' }
    },
  })
  equal(await (await binding.machine('parent')).read('file'), 'text')
  equal(await binding.cwd('parent'), '/old-worktree/sub')
  equal(translated, 1)
  equal(f.requests, [])
  equal(f.wakes, [
    { id: 'old-home-machine', address: '/old-worktree' },
    { id: 'old-home-machine', address: '/old-worktree' },
  ])
})

test('machine resolver provisions only on a file call and resolves paths from session cwd', async () => {
  let f = await fixture()
  let paths: string[] = []
  f.m.read = (path) => {
    paths.push(path)
    return Promise.resolve('kept')
  }
  await f.g.apply([{
    entity: { eid: 'parent' },
    home: { cwd: '/checkout/sub' },
  }])
  let { machineTools } = await import('./machine.ts')
  let tools = machineTools((ctx) => f.binding.machine(ctx!.session), {
    cwd: (ctx) => f.binding.cwd(ctx!.session),
  })
  equal(f.requests, [])
  let value = await tools.find((tool) => tool.name == 'read')!.run({
    path: 'file',
  }, {
    session: 'parent',
    call: { entity: { eid: 'read-call' } },
    entries: [],
  })
  equal(value, 'kept')
  equal(paths, ['/checkout/sub/file'])
  equal(f.requests.length, 1)
})
