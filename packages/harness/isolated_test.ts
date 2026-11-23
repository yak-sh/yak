// A session outside words started is answered with its own registry: its
// sandbox's machine, submit_patch and the host tools the isolation names.
import { equal, ok, test } from '@yaks/testing'
import { compose } from '@yaks/cli/host'
import type { Comp, Graph } from '@yaks/graph'
import type { Proc, Workspace } from '@yaks/machine'
import type { SandboxProvider, SandboxRequest } from '@yaks/sandbox'
import type { Runner, Tool } from '@yaks/session'
import { line } from '@yaks/query'
import { exposed, isolate, layerKey, setupLayer } from './isolated.ts'
import { at } from './testing.ts'

let BUG = '55555555-5555-4555-8555-555555555555'

// A machine whose every command prints `out` and exits 0, recording each.
let machine = (out: string, ran: string[]): Workspace => ({
  start: (command) => {
    ran.push(command)
    return Promise.resolve('p')
  },
  look: () => Promise.resolve({ exit: { code: 0 } } as unknown as Proc),
  tail: () => Promise.resolve(out.split('\n')),
  kill: () => Promise.resolve(),
  read: () => Promise.resolve(''),
  stat: () => Promise.resolve([]),
  write: () => Promise.resolve(),
})

let office = async (diff = 'diff --git a/x b/x\n+fixed') => {
  let config = at()
  let host = await compose(
    { ...config, plugins: [...config.plugins!, '@yaks/heal', '@yaks/mail'] },
    ['graph'],
    undefined,
  )
  let g: Graph = host.graph
  await g.apply([
    { entity: { eid: 'fixer' }, session: {}, fixer: { bug: BUG } },
    { entity: { eid: 'helper' }, session: {}, helping: { project: 'p' } },
    { entity: { eid: 'child' }, session: {}, spawned: { parent: 'fixer' } },
    { entity: { eid: 'landing' }, session: {}, lands: { from: 'helper' } },
    { entity: { eid: 'mine' }, session: {} },
    { entity: { eid: 'p' }, project: {} },
  ], { trusted: true })
  let ran: string[] = []
  let requested: SandboxRequest[] = []
  let disposed: string[] = []
  let sandbox: SandboxProvider = {
    request: (r) => {
      requested.push(r)
      return Promise.resolve({
        workspace: machine(diff, ran),
      })
    },
    connect: () => Promise.reject(new Error('unused')),
    dispose: (r) => {
      disposed.push(r.id)
      return Promise.resolve()
    },
    export: async function* () {},
  }
  let tool = (name: string): Tool => ({
    name,
    description: name,
    parameters: { type: 'object' },
    run: () => name,
  })
  let runner = {
    holder: 'me',
    model: {} as Runner['model'],
    tools: ['shell', 'graph_apply', 'graph_query'].map(tool),
    named: () => ['mail_send', 'session_handup', 'admin_errors'].map(tool),
    resolveInstructions: () => 'The persona.',
  } as Runner
  let scope = isolate(g, { sandbox })
  return { host, g, runner, scope, ran, requested, disposed }
}

test('a fixer, a helper and what they start are exposed; a lander and a person’s session are not', async () => {
  let o = await office()
  try {
    let seen = []
    for (let s of ['fixer', 'helper', 'child', 'landing', 'mine']) {
      seen.push(await exposed(o.g, s))
    }
    equal(seen, [true, true, true, false, false])
  } finally {
    await o.host.close()
  }
})

test('an exposed session holds its sandbox, submit_patch and the named reads, nothing else of the host', async () => {
  let o = await office()
  try {
    let r = await o.scope('fixer', o.runner)
    let names = (await r.toolSnapshot!('ask', 'fixer', undefined, []))
      .map((t) => t.name)
    ok(names.includes('shell') && names.includes('submit_patch'))
    ok(names.includes('graph_query') && names.includes('session_handup'))
    for (let host of ['graph_apply', 'mail_send', 'admin_errors']) {
      ok(!names.includes(host), host)
    }
    equal(r.named!(), [])
    equal(r.resolveTools, undefined)
    ok(
      String(await r.resolveInstructions!(undefined, 'fixer')).startsWith(
        'The persona.\n\nYou work in an isolated sandbox',
      ),
    )
    // The sandbox's shell is the sandbox's, not the host's.
    await r.tools.find((t) => t.name == 'shell')!.run(
      { command: 'ls' },
      { session: 'fixer', call: { entity: { eid: 'c1' } }, entries: [] },
    )
    equal(o.requested.map((x) => x.from), ['HEAD'])
    equal(await o.scope('mine', o.runner), o.runner)
  } finally {
    await o.host.close()
  }
})

test('submit_patch hands the patch and the task’s claim to a lander; a sandbox lasts one run', async () => {
  let o = await office()
  try {
    await o.g.apply([
      { entity: { eid: 'task' }, task: {}, doc: { title: 'Fix the gate' } },
      { entity: { eid: 'task' }, claim: { session: 'fixer' } },
      {
        entity: { eid: 'asked' },
        entry: { session: 'fixer' },
        content: { body: 'T-1 — Fix the gate' },
        using: { provider: 'openai', effort: 'high' },
      },
    ], { trusted: true })
    let r = await o.scope('fixer', o.runner)
    let said = await r.tools.find((t) => t.name == 'submit_patch')!.run(
      { summary: 'Guards the gate.' },
      { session: 'fixer', call: { entity: { eid: 'c2' } }, entries: [] },
    )
    let [lander] = await o.g.read('.lands.from=fixer ?session ?native')
    ok(String(said).includes(lander.entity.eid))
    ok(lander.native)
    equal(await exposed(o.g, lander.entity.eid), false)
    let [first] = await o.g.read(
      line`.entry.session=${lander.entity.eid} ?content ?using`,
    )
    let body = String((first.content as Comp).body)
    ok(body.includes('Fix the gate') && body.includes('+fixed'))
    ok(body.includes('Guards the gate.'))
    ok(body.includes('> T-1 — Fix the gate'))
    let [fixer] = await o.g.read(line`.entity.eid=asked ?using`)
    equal(first.using, fixer.using)
    // It lands and answers whatever its persona's own list holds.
    let [chosen] = await o.g.read(
      line`.entity.eid=${first.entity.eid} ?sending`,
    )
    ok(
      ['shell', 'land', 'admin_support'].every((t) =>
        ((chosen.sending as Comp).tools as string[]).includes(t)
      ),
    )
    let [task] = await o.g.get(['task'], ['claim'])
    equal((task.claim as Comp).session, lander.entity.eid)
    // The handed sandbox is let go, and so is a run's when it ends; the next
    // run is asked for in another.
    equal(o.disposed, [o.requested[0].id])
    await r.ended!('fixer')
    equal(o.disposed, [o.requested[0].id, o.requested[0].id])
    await o.g.apply([{
      entity: { eid: 'again' },
      entry: { session: 'fixer' },
      content: { body: 'continue' },
      using: { provider: 'openai' },
    }], { trusted: true })
    let shell = (call: string) =>
      r.tools.find((t) => t.name == 'shell')!.run(
        { command: 'ls' },
        { session: 'fixer', call: { entity: { eid: call } }, entries: [] },
      )
    await shell('c3')
    ok(o.requested.at(-1)!.id != o.disposed[0])
    // Each ask of the run carries `using` too, and keeps the run's sandbox.
    await o.g.apply([{
      entity: { eid: 'turn' },
      entry: { session: 'fixer' },
      ask: {},
      using: { provider: 'openai' },
    }], { trusted: true })
    await shell('c4')
    equal(o.requested.at(-1)!.id, o.requested.at(-2)!.id)
  } finally {
    await o.host.close()
  }
})

test('a helper holding no task hands over the one its letter filed, with or without a patch', async () => {
  for (let diff of ['diff --git a/x b/x\n+fixed', '']) {
    let o = await office(diff)
    try {
      await o.g.apply([
        { entity: { eid: 'letter' }, task: {}, doc: { title: 'Letter: red' } },
      ], { trusted: true })
      let r = await o.scope('helper', o.runner)
      let hand = (args: Record<string, string>, call: string) =>
        r.tools.find((t) => t.name == 'submit_patch')!.run(args, {
          session: 'helper',
          call: { entity: { eid: call } },
          entries: [],
        })
      // What it took filed the task: it needs no naming.
      await o.g.apply([
        { entity: { eid: 'mail' }, routine: { project: 'p' } },
        { entity: { eid: 'mail' }, notified: {}, $actor: { via: 'helper' } },
        {
          entity: { eid: 'filed' },
          about: {},
          edge: { from: 'letter', to: 'mail' },
        },
      ], { trusted: true })
      equal(
        await hand({ summary: 'x', task: 'nothing' }, 'c1'),
        'No task nothing; nothing handed over.',
      )
      await hand(
        { summary: 'Declined: answer the thread.' },
        'c2',
      )
      // Not the office's own lander of the helper's.
      let [lander] = (await o.g.read('.lands.from=helper'))
        .filter((b) => b.entity.eid != 'landing')
      let [first] = await o.g.read(
        line`.entry.session=${lander.entity.eid} ?content`,
      )
      let body = String((first.content as Comp).body)
      ok(body.includes('Letter: red') && body.includes('Declined'))
      equal(body.includes('+fixed'), !!diff)
      let [task] = await o.g.get(['letter'], ['claim'])
      equal((task.claim as Comp).session, lander.entity.eid)
    } finally {
      await o.host.close()
    }
  }
})

// One `git ls-tree -r -z` entry for each path, its blob named by `blob`.
let tree = (files: Record<string, string>) =>
  Object.entries(files).map(([path, blob]) => `100644 blob ${blob}\t${path}`)
    .join('\0')

test('commits share a dependency layer until a manifest or the setup changes', () => {
  let base = { 'deno.lock': 'a', 'packages/x/package.json': 'b', 'x.ts': 'c' }
  let key = layerKey('deno install', tree(base))
  equal(layerKey('deno install', tree({ ...base, 'x.ts': 'd' })), key)
  ok(layerKey('deno install', tree({ ...base, 'deno.lock': 'e' })) != key)
  ok(
    layerKey(
      'deno install',
      tree({ ...base, 'packages/x/package.json': 'f' }),
    ) !=
      key,
  )
  ok(layerKey('pnpm install', tree(base)) != key)
  let setup = { install: 'offline install', warm: 'fill cache' }
  ok(
    layerKey(setup, tree(base)) !=
      layerKey({ ...setup, warm: 'refill' }, tree(base)),
  )
})

test('a dependency layer fills a cold cache before retrying its offline install', async () => {
  let cached = new Set<string>()
  let needed = ['root dependency', 'workspace dependency']
  let warmups = 0
  let installs: string[][] = []
  let setup = { install: 'offline install', warm: 'fill cache' }
  let shell = (script: string): Promise<void> => {
    if (script == setup.warm) {
      warmups++
      needed.forEach((name) => cached.add(name))
    } else if (needed.some((name) => !cached.has(name))) {
      return Promise.reject(new Error('package missing from cache'))
    } else {
      installs.push([...needed])
    }
    return Promise.resolve()
  }
  await setupLayer(setup, shell)
  needed.push('new workspace dependency')
  await setupLayer(setup, shell)
  await setupLayer(setup, shell)
  equal(installs, [needed.slice(0, -1), needed, needed])
  equal(warmups, 2)
})
