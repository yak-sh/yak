import { machineDoc } from '@yaks/machine/vocab'
import { fileDoc } from '@yaks/file/vocab'

import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { type Bundle, type Comp, graph } from '@yaks/graph'
import { edgeDoc, edgeKeywords, link } from '@yaks/edge'
import { effectDoc, type Effects, effects, POOL, take } from '@yaks/effects'
import { modelDoc } from '@yaks/model'
import { ram } from '@yaks/ram'
import { sessionDoc, sessions, unanswered, wake } from '@yaks/session'
import { toolsDoc } from '@yaks/tools/vocab'
import { loadVocab } from '@yaks/vocab'
import { launch, processDoc, processes } from '@yaks/process'
import { spawning } from './effects.ts'
import { adopting } from './service.ts'
import { asked as jobOf, carry, finish, type Opts, start } from './run.ts'
import { sessionEnv } from '@yaks/session'
import { asking, bare, fake, host, tracked, until } from './testing.ts'
import { spawnDoc } from './vocab.ts'
import { transcriptGraph } from '../session/testing.ts'

let comp = (b: Bundle | undefined, name: string) =>
  (b?.[name] ?? undefined) as Comp | undefined

let dir = () => Deno.makeTempDirSync({ prefix: 'yaks-spawn-' })

let launched: typeof launch = async (g, spec, options = {}) => {
  let eid = String(options.eid)
  await g.apply([{
    entity: { eid },
    process: { pid: 1, command: spec.command },
    exit: { code: 0 },
  }])
  return { eid, pid: 1, done: Promise.resolve(0), elapsed: () => 0 }
}

// The facet, composed the way `yak serve` composes it.
let watching = (g: ReturnType<typeof tracked>, o: Record<string, unknown>) =>
  g.fx.handle(
    spawning({ adapters: { fake }, launch: launched, ...o })({ graph: g.g }),
  )

let said = (g: { read: (q: string) => unknown }) =>
  g.read('.entry&.order=entry.seq&*') as Promise<Bundle[]>

// The persona a run starts with: the instruction its provider was given.
let persona = async (...rows: Bundle[]) => {
  let { g } = tracked()
  let where = dir()
  let given: string | undefined
  try {
    await g.apply([...asking('S1', 'E1', 'do the thing'), ...rows])
    await start(g, 'S1', {
      cwd: where,
      dir: where,
      poll: 5,
      launch: launched,
      adapters: {
        fake: {
          ...fake,
          argv: (job) => {
            given = job.persona
            return fake.argv(job)
          },
        },
      },
    })
    await until(
      async () => comp((await said(g)).at(-1), 'stop'),
      'the managed provider to exit',
    )
    return given
  } finally {
    Deno.removeSync(where, { recursive: true })
  }
}

let voiced = (eid: string, body: string, home?: string): Bundle => ({
  entity: { eid },
  doc: { title: eid, body },
  persona: home ? { home } : {},
})

test('the chosen persona reaches a managed provider', async () => {
  let given = await persona(voiced('N1', 'Keep the graph true.'), {
    entity: { eid: 'S1' },
    session: { persona: 'N1' },
  })
  assert(given?.includes('Keep the graph true.'))
})

test("a run on a sub-project's task hears each common persona above it", async () => {
  let given = await persona(
    { entity: { eid: 'P1' }, project: {} },
    { entity: { eid: 'P2' }, project: {}, filed: { project: 'P1' } },
    voiced('N1', 'Keep the graph true.', 'P1'),
    voiced('N2', 'Mind the platform.', 'P2'),
    link('P1', 'contains', 'N1'),
    link('P2', 'contains', 'N2'),
    { entity: { eid: 'T1' }, task: {}, filed: { project: 'P2' } },
    { entity: { eid: 'T1' }, claim: { session: 'S1' } },
  )
  assert(given?.includes('Mind the platform.'), given)
  assert(given?.includes('Keep the graph true.'), given)
})

test('a request made beside a server is started by the server, not the command', async () => {
  let vocab = loadVocab(
    [
      sessionDoc,
      toolsDoc,
      modelDoc,
      fileDoc,
      machineDoc,
      processDoc,
      edgeDoc,
      effectDoc,
      spawnDoc,
    ],
    [edgeKeywords],
  )
  let storage = ram(vocab, { number: true })
  // One store, two processes: a one-shot command and a server working the
  // effects. Each has its own registry and graph, as it would.
  let process = (me: string) => {
    let fx: Effects = effects(vocab, {
      owner: me,
      write: (b) => g.apply(b, { trusted: true }),
    })
    let g = graph({ storage, vocab, plugins: [sessions(), processes(), fx] })
    fx.handle(
      spawning({ adapters: { fake }, launch: launched, cwd: where })({
        graph: g,
      }, { dir: where, poll: 5 }),
    )
    return { g, fx }
  }
  let where = dir()
  let command = crypto.randomUUID()
  let serving = crypto.randomUUID()
  let cmd = process(command)
  let g = cmd.g
  // The server is up and working the pool.
  await take(g, `${POOL}/${serving}`, { holder: serving })
  try {
    await g.apply(asking('S1', 'E1', 'do the thing'))
    await cmd.fx.work(g)
    // The command started nothing, and the run waits for the server.
    assertEquals(comp((await g.read('.session&*'))[0], 'process'), undefined)
    let [row] = await g.read('.effect.comp=using&*')
    assertEquals(comp(row, 'effect')?.state, 'pending')
    assertEquals(comp(row, 'effect')?.attempts, 0)
    // The server's next pass starts it.
    let server = process(serving)
    await server.fx.work(server.g)
    await until(
      async () => comp((await said(g)).at(-1), 'stop'),
      'the run the server started to end',
    )
  } finally {
    Deno.removeSync(where, { recursive: true })
  }
})

test('a run speaks as its own session, never its launcher’s', () => {
  let env = sessionEnv('S1', {
    PATH: '/bin',
    CLAUDE_CODE_SESSION_ID: 'launcher',
    CODEX_THREAD_ID: 'launcher-thread',
    TASKS_SESSION: 'launcher-task',
  })
  assertEquals(env, { PATH: '/bin', TASKS_SESSION: 'S1' })
})

// Compose this stopped-request host once, before its commit is exercised.
let stopped = tracked()
let stoppedDir = dir()
watching(stopped, { cwd: stoppedDir, dir: stoppedDir, poll: 5 })
await stopped.g.apply([
  ...asking('S1', 'E1', 'linger here'),
  { entity: { eid: 'S1' }, stop: {} },
])
await stopped.fx.idle()
test('a stop committed with a request prevents its launch', async () => {
  let g = stopped
  let where = stoppedDir
  try {
    let [row] = await g.g.get(['S1'])
    assertEquals(comp(row, 'process'), undefined)
  } finally {
    Deno.removeSync(where, { recursive: true })
  }
})

test('a command passing through adopts no run', async () => {
  // Its tails would outlive the lease it gives back on the way out, so it
  // does not so much as look.
  let looked = false
  let untouched = new Proxy({}, { get: () => (looked = true, undefined) })
  await adopting()({ graph: untouched } as never, {}, AbortSignal.abort())
  assertEquals(looked, false)
})

// A session asked to work `y`, which requires `x`, holding `y`, applied once
// as the module loads with what follows it, and laid into a graph of each
// test's own. Its provider starts no process: what it was told to carry on is
// kept in `started`.
let image = async (...batches: Bundle[][]): Promise<Bundle[]> => {
  let g = bare()
  let rows: Bundle[] = []
  for (let b of batches) rows.push(...await g.apply(b))
  return rows
}
let asked = [
  { entity: { eid: 'x' }, task: {} },
  { entity: { eid: 'y' }, task: {} },
  link('y', 'requires', 'x'),
  ...asking('S1', 'E1', 'work y'),
  { entity: { eid: 'S1' }, session: { id: 'S1' }, process: { pid: 1 } },
  { entity: { eid: 'y' }, claim: { session: 'S1' } },
]
const over = [{ entity: { eid: 'S1' }, exit: { code: 0 } }]
// x completes, after the claim on y was taken
let finished = [{ entity: { eid: 'x' }, completed: {} }]
// The run over and its turn ended, then x finished; or x finished while the
// run goes.
let PARKED = await image(asked, [...over, {
  entity: { eid: 'E1:end' },
  entry: { session: 'S1' },
  ask: { through: 'E1' },
  stop: {},
}], finished)
let GOING = await image(asked, finished)

let JOB = (await jobOf(bare(GOING), 'S1'))!
let parking = (rows: Bundle[]) => {
  // Session owns admission, compare-and-set and task wake policy (wake_test).
  // Here its RAM transcript door keeps queries, entries and sequencing;
  // spawn owns finishing a run and carrying the resulting input to its thread.
  let g = transcriptGraph(host)
  g.apply(rows)
  let started: string[][] = []
  let opts = {
    adapters: {
      fake: {
        ...fake,
        argv: (j) => ['agent', String(j.thread), j.instruction],
      },
    },
  } satisfies Opts
  return {
    g,
    opts,
    started,
    // The process observer has recorded its exit; graph admission is not
    // part of finishing this transcript's turn.
    exited: () => g.apply(over),
    // what `session_wake` runs for x's completing
    wake: () => wake(g, 'x'),
    // The same command preparation start() uses, before the process and
    // log boundary.
    request: async () => {
      let [row] = await g.get(['S1'])
      let job = carry(row, JOB, await unanswered(g, 'S1'))
      if (job) started.push(opts.adapters.fake.argv(job))
    },
  }
}

let parkedRun = parking(PARKED)
let goingRun = parking(GOING)

test('a run that ends waiting on a dependency carries on its thread when it finishes', async () => {
  let p = parkedRun
  await p.wake()
  await p.request()
  assertEquals(p.started.length, 1)
  let [agent, thread, instruction] = p.started[0]
  assertEquals([agent, thread], ['agent', 'S1'])
  assert(instruction.includes('has finished'), instruction)
})

test('a dependency that finishes while the run goes is told as it ends', async () => {
  let p = goingRun
  await p.wake()
  assertEquals(p.started, [])
  // After the final log bytes, follow() finishes the turn and tells it
  // what completed while it ran, before preparing the next command.
  p.exited()
  assertEquals(await finish(p.g, 'S1', {}, 'E1'), true)
  await p.request()
  assertEquals(p.started.length, 1)
  assertEquals(p.started[0].slice(0, 2), ['agent', 'S1'])
  assert(p.started[0][2].includes('has finished'), p.started[0][2])
})
