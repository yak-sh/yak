import { machineDoc } from '@yaks/machine/vocab'
// A real child, because a spawn that only ever launched a fake one would
// prove nothing: the two escapes, the pidfile, the detached log and the
// ending are the thing under test. The provider is a shell script, so the
// whole file costs a few hundred milliseconds.

import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { type Bundle, type Comp, graph } from '@yaks/graph'
import { edgeDoc, edgeKeywords, link } from '@yaks/edge'
import { effectDoc, type Effects, effects, POOL, take } from '@yaks/effects'
import { modelDoc } from '@yaks/model'
import { ram } from '@yaks/ram'
import {
  sessionDoc,
  sessions,
  transcriptUsage,
  unanswered,
  wake,
} from '@yaks/session'
import { toolsDoc } from '@yaks/tools/vocab'
import { loadVocab } from '@yaks/vocab'
import { launch, processDoc, processes, store } from '@yaks/process'
import { spawning } from './effects.ts'
import { adopting } from './service.ts'
import { checkoutDoc } from '@yaks/git/vocab'
import {
  asked as jobOf,
  carry,
  checkoutOf,
  down,
  finish,
  type Opts,
  start,
} from './run.ts'
import { sessionEnv } from '@yaks/session'
import { asking, bare, fake, host, tracked, until } from './testing.ts'
import { spawnDoc } from './vocab.ts'
import { transcriptGraph } from '../session/testing.ts'

let comp = (b: Bundle | undefined, name: string) =>
  (b?.[name] ?? undefined) as Comp | undefined

let dir = () => Deno.makeTempDirSync({ prefix: 'yaks-spawn-' })

// The facet, composed the way `yak serve` composes it.
let watching = (g: ReturnType<typeof tracked>, o: Record<string, unknown>) =>
  g.fx.handle(spawning({ adapters: { fake }, ...o })({ graph: g.g }))

let said = (g: { read: (q: string) => unknown }) =>
  g.read('.entry&.order=entry.seq&*') as Promise<Bundle[]>

let bodies = async (g: { read: (q: string) => unknown }) =>
  (await said(g)).map((b) => String(comp(b, 'content')?.body ?? ''))

test('the request starts the provider, and what it printed is the transcript', async () => {
  let g = tracked()
  let where = dir()
  watching(g, { dir: where, poll: 5 })
  try {
    await g.g.apply(asking('S1', 'E1', 'do the thing'))
    // The turn's ending is an entry, so the transcript settles by itself. It
    // is read in after the text before it, so wait for the ending itself.
    await until(
      async () => comp((await said(g.g)).at(-1), 'stop'),
      'the turn to end',
    )
    assert((await bodies(g.g)).includes('working: do the thing'))
    let last = (await said(g.g)).at(-1)!
    assertEquals(comp(last, 'stop'), {})
    assertEquals(comp(last, 'usage')?.output_tokens, 34)
    // Where a daemon's ask keeps it, so what reads a transcript's usage reads
    // a run's.
    let [cost] = await transcriptUsage(g.g, 'S1')
    assertEquals(comp(cost, 'usage')?.output_tokens, 34)
    assertEquals(comp(cost, 'ask')?.through, 'E1')
    await until(
      async () => comp((await g.g.read('.session&*'))[0], 'exit'),
      'the ending',
    )
    let [row] = await g.g.read('.session&*')
    // The process rides the session's own entity, and the provider was told
    // to call its thread by that same name.
    assertEquals(comp(row, 'session')?.id, 'S1')
    assertEquals(comp(row, 'exit')?.code, 0)
  } finally {
    Deno.removeSync(where, { recursive: true })
  }
})

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
      async () => comp((await g.get(['S1']))[0], 'exit'),
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
    [sessionDoc, toolsDoc, modelDoc, processDoc, edgeDoc, effectDoc, spawnDoc],
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
      spawning({ adapters: { fake } })({ graph: g }, { dir: where, poll: 5 }),
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
      async () => comp((await g.read('.session&*'))[0], 'exit'),
      'the run the server started to end',
    )
  } finally {
    Deno.removeSync(where, { recursive: true })
  }
})

test('a run works in a checkout of its own, taken back when it ends', async () => {
  let vocab = loadVocab(
    [
      sessionDoc,
      toolsDoc,
      modelDoc,
      processDoc,
      edgeDoc,
      checkoutDoc,
      machineDoc,
      spawnDoc,
    ],
    [edgeKeywords],
  )
  let fx = effects(vocab, { write: (b) => g.apply(b, { trusted: true }) })
  let g = graph({
    storage: ram(vocab, { number: true }),
    vocab,
    plugins: [sessions(), processes(), fx],
  })
  let top = await Deno.realPath(dir())
  let repo = `${top}/repo`
  let runs = `${top}/runs`
  await Deno.mkdir(repo)
  await Deno.mkdir(runs)
  let sh = (...args: string[]) =>
    new Deno.Command('git', { cwd: repo, args, stdout: 'null' }).output()
  let branches = async () =>
    new TextDecoder().decode(
      (await new Deno.Command('git', { cwd: repo, args: ['branch', '--list'] })
        .output()).stdout,
    )
  await sh('init', '-q', '-b', 'main', '.')
  await sh(
    '-c',
    'user.email=t@example.org',
    '-c',
    'user.name=T',
    'commit',
    '-q',
    '--allow-empty',
    '-m',
    'initial',
  )
  fx.handle(
    spawning({ adapters: { fake } })({ graph: g }, {
      dir: top,
      poll: 5,
      cwd: repo,
      worktrees: runs,
    }),
  )
  try {
    await g.apply(asking('S1', 'E1', 'do the thing'))
    await until(
      async () => comp((await g.read('.session&*'))[0], 'process'),
      'the run to start',
    )
    let [row] = await g.read('.session&*')
    assertEquals(comp(row, 'process')?.cwd, checkoutOf('S1', runs))
    // It held nothing, so once it ends its checkout is gone again, and then
    // the branch it was cut on (@yaks/git `reclaim`). The branch goes last:
    // until it has, git is still writing in the repository.
    await until(
      async () =>
        await Deno.stat(checkoutOf('S1', runs)).then(() => false, () => true) &&
        !(await branches()).includes('session-S1'),
      'its checkout and its branch to be taken back',
    )
  } finally {
    Deno.removeSync(top, { recursive: true })
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

test('a stop on the session reaches the agent', async () => {
  let g = tracked()
  let where = dir()
  watching(g, { dir: where, poll: 5, grace: 500 })
  try {
    await g.g.apply(asking('S1', 'E1', 'linger here'))
    await until(
      async () => comp((await g.g.read('.session&*'))[0], 'process')?.pid,
      'a pid',
    )
    await g.g.apply([{ entity: { eid: 'S1' }, stop: {} }])
    let over = await until(
      async () => comp((await g.g.read('.session&*'))[0], 'exit'),
      'the agent to go',
    )
    assert(over, 'no ending stamped')
    // It was killed rather than finishing, and the transcript says so.
    let stop = await until(
      async () => comp((await said(g.g)).at(-1), 'stop'),
      'the transcript to record its stop',
    )
    assertEquals(stop, {})
  } finally {
    Deno.removeSync(where, { recursive: true })
  }
})

// Compose this stopped-request host once, before its commit is exercised.
let stopped = tracked()
let stoppedDir = dir()
watching(stopped, { dir: stoppedDir, poll: 5 })
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

test('a restart adopts the run and reads its log on from where it stands', async () => {
  let g = tracked()
  let where = dir()
  try {
    // A server that launched an agent and then went away: the rows are there,
    // the log is being written, and nobody is reading it.
    await g.g.apply(asking('S1', 'E1', 'linger here'))
    let argv = fake.argv({ session: 'S1', instruction: 'linger here' })
    await launch(store(g.g), {
      command: argv[0],
      args: argv.slice(1),
      env: Deno.env.toObject(),
    }, { eid: 'S1', dir: where, poll: 5 })
    // The wrapper opens the log after launch returns, so at first it is absent.
    await until(
      async () =>
        ((await Deno.stat(`${where}/S1.out`).catch(() => null))?.size ?? 0) >
          100,
      'the log to fill',
    )
    assertEquals((await said(g.g)).length, 1) // only the request so far

    // The restart: the duty, held by a process that stays up.
    let up = new AbortController()
    let duty = adopting({ adapters: { fake } })(
      { graph: g.g },
      { dir: where, poll: 5 },
      up.signal,
    )
    await until(
      async () => (await bodies(g.g)).includes('working: linger here'),
      'the lines written while we were away',
    )
    await down(g.g, 'S1', { dir: where, poll: 5, grace: 500 })
    await until(
      async () => comp((await g.g.read('.session&*'))[0], 'exit'),
      'the agent to go',
    )
    up.abort()
    await duty
  } finally {
    Deno.removeSync(where, { recursive: true })
  }
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
  // Here its RAM transcript door keeps real queries, entries and sequencing;
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
    // log boundary (covered above with a real child).
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
