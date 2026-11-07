// Defaults may change without redirecting recorded calls or process handles.
import { equal, ok, test, throws } from '@yaks/testing'
import { graph, mint, Refused } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { kernelDoc } from '@yaks/kernel'
import { docs as toolsDocs } from '@yaks/tools/vocab'
import { processDoc } from '@yaks/process'
import { docs as sessionDocs } from '@yaks/session/vocab'
import { docs as harnessDocs } from '@yaks/harness/vocab'
import { machineDoc } from './vocab.ts'
import { workspacePolicy } from './graph.ts'
import { overdue, processWorkspace, sessionHome, targetFor } from './targets.ts'
import { executionWorkspace } from './execution.ts'
import { workspaceTools } from './tools.ts'
import type { Workspace } from './workspace.ts'

let vocab = loadVocab([
  kernelDoc,
  ...toolsDocs,
  processDoc,
  ...sessionDocs,
  ...harnessDocs,
  machineDoc,
])
let fixture = async () => {
  let g = graph({ storage: ram(vocab), vocab, plugins: [workspacePolicy()] })
  let session = mint(), a = mint(), b = mint(), call = mint(), process = mint()
  await g.apply([
    {
      entity: { eid: session },
      session: {},
      home: { workspace: a, cwd: '/a/sub' },
    },
    { entity: { eid: a }, workspace: { root: '/a' } },
    { entity: { eid: b }, workspace: { root: '/b' } },
    { entity: { eid: call }, call: { args: { command: 'pwd' } } },
    {
      entity: { eid: process },
      process: { workspace: a, command: 'pwd', cwd: '/a/sub' },
    },
  ])
  return { g, session, a, b, call, process }
}
let change = await fixture(),
  direct = await fixture(),
  replay = await fixture(),
  missing = await fixture()
let starts: unknown[] = [], connections: string[] = []
let m: Workspace = {
  start: (command, cwd) => {
    starts.push([command, cwd])
    return Promise.resolve(replay.process)
  },
  receipt: () => Promise.resolve(replay.process),
  look: () => Promise.resolve({ exit: { code: 0 } }),
  tail: () => Promise.resolve([]),
  kill: () => Promise.resolve(),
  read: (path) => Promise.resolve(path),
  stat: () => Promise.resolve([]),
  write: () => Promise.resolve(),
}
let tools = workspaceTools(replay.g, {
  connect: (id) => {
    connections.push(id)
    return Promise.resolve(m)
  },
})
let by = (name: string) => tools.find((t) => t.name == name)!
let ctx = {
  session: replay.session,
  call: { entity: { eid: replay.call } },
  entries: [],
}
await by('shell').run({ command: 'pwd' }, ctx)
await sessionHome(replay.g, replay.session, replay.b)
let recorded = (await replay.g.get([replay.call]))[0].call as {
  args: Record<string, unknown>
}
await by('shell').recover!(recorded.args, ctx)
await by('wait').run({ process: replay.process, timeout: 0 })
await by('stop').run({ process: replay.process })
let relative = await by('read').run({ path: 'file' }, {
  ...ctx,
  call: { entity: { eid: mint() } },
})

test('home change clears cwd and subsequent calls select the new workspace root', async () => {
  await sessionHome(change.g, change.session, change.b)
  equal(await targetFor(change.g, change.session, {}), {
    workspace: change.b,
    cwd: '/b',
  })
})
test('explicit workspace does not inherit a different workspace cwd', async () => {
  equal(await targetFor(direct.g, direct.session, { workspace: direct.b }), {
    workspace: direct.b,
    cwd: '/b',
  })
})
test('graph home writes validate the same target and cwd as the convenience', async () => {
  await throws(() =>
    direct.g.apply([{
      entity: { eid: direct.session },
      home: { workspace: mint() },
    }])
  )
  await throws(() =>
    direct.g.apply([{
      entity: { eid: direct.session },
      home: { cwd: 'relative' },
    }])
  )
})
test('workspace placement cannot redirect retained calls', async () => {
  await throws(() =>
    direct.g.apply([{
      entity: { eid: direct.a },
      workspace: { root: '/elsewhere' },
    }])
  )
})
test('shell records its target and recovery wait and stop keep the original workspace after home changes', () => {
  equal(recorded.args, { command: 'pwd', workspace: replay.a, cwd: '/a/sub' })
  equal(starts, [['pwd', '/a/sub']])
  equal(connections, [replay.a, replay.a, replay.a, replay.a, replay.b])
  equal(relative, '/b/file')
})
test('missing targets never fall back to local execution', async () => {
  await throws(() => targetFor(missing.g, undefined, {}))
  await throws(() => by('wait').run({ process: mint() }))
})

test('a refusal for a workspace not named, or named wrong, says how to name one and which exist', async () => {
  let { g, a, b } = missing
  for (
    let [args, said] of [
      [{}, 'No workspace named, and the session has no home: workspace takes'],
      [
        { workspace: 'code' },
        "Not a workspace: code. workspace takes a workspace entity's eid, such as",
      ],
    ] as [Record<string, unknown>, string][]
  ) {
    let { message } = await throws(
      () => targetFor(g, undefined, args),
      said,
    ) as Error
    for (
      let one of [`${a} (/a)`, `${b} (/b)`, "'.workspace.root=<directory>'"]
    ) {
      ok(message.includes(one), message)
    }
  }
})

test('an absent process is a caller refusal, never a local recovery guess', async () => {
  let error = await throws(
    () => processWorkspace(missing.g, mint()),
    'Process launch workspace is unknown',
  )
  ok(error instanceof Refused)
})

test('a workspace process nobody waited out has its ending recorded by the next look', async () => {
  let g = graph({ storage: ram(vocab), vocab })
  let here = mint(), gone = mint(), broken = mint()
  let ended = mint(),
    running = mint(),
    lost = mint(),
    away = mint(),
    stuck = mint(),
    done = mint()
  // What each run's receipt says, as the look script prints it.
  let receipts: Record<string, string> = {
    [ended]: 'exit 3',
    [running]: 'running 4242',
    [lost]: 'lost',
  }
  let transport = {
    execute: (script: string) =>
      Promise.resolve(
        Object.entries(receipts).find(([id]) => script.includes(id))?.[1] ??
          'pending',
      ),
  }
  let row = (eid: string, workspace: string) => ({
    entity: { eid },
    process: { workspace, command: 'true', cwd: '/' },
  })
  await g.apply([
    row(ended, here),
    row(running, here),
    row(lost, here),
    row(away, gone),
    row(stuck, broken),
    { ...row(done, here), exit: { code: 0 } },
  ])
  let failures: string[] = []
  let looked = await overdue(g, {
    connect: (workspace) => {
      if (workspace == gone) throw new Refused('released')
      if (workspace == broken) throw new Error('unreachable')
      return Promise.resolve(
        executionWorkspace(g, transport, {
          workspace,
          root: '/',
          receipts: '/receipts',
        }),
      )
    },
  }, (_, workspace) => failures.push(workspace))
  let exits = Object.fromEntries(
    (await g.get([ended, running, lost, away, stuck, done], ['exit']))
      .map((b) => [b.entity.eid, b.exit ?? null]),
  )
  equal(looked, 3)
  equal(exits, {
    [ended]: { code: 3 },
    [running]: null,
    [lost]: {},
    [away]: null,
    [stuck]: null,
    [done]: { code: 0 },
  })
  equal(failures, [broken])
})
