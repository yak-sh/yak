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
import {
  launch,
  type Process,
  processDoc,
  processes,
  selfEid,
} from '@yaks/process'
import { spawning } from './effects.ts'
import { adopting } from './service.ts'
import {
  asked as jobOf,
  carry,
  emptyOf,
  finish,
  type Opts,
  start,
  takeUp,
} from './run.ts'
import { sessionEnv } from '@yaks/session'
import {
  asking,
  bare,
  FAKE,
  fake,
  host,
  launching,
  tracked,
  until,
} from './testing.ts'
import { spawnDoc } from './vocab.ts'
import { transcriptGraph } from '../session/testing.ts'

let comp = (b: Bundle | undefined, name: string) =>
  (b?.[name] ?? undefined) as Comp | undefined
let proc = (b: Bundle | undefined) => comp(b, 'process') as Process | undefined

let dir = () => Deno.makeTempDirSync({ prefix: 'yaks-spawn-' })
let exists = (path: string) => {
  try {
    Deno.statSync(path)
    return true
  } catch {
    return false
  }
}

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

test('a request offered no tools starts bare, in an empty directory removed with the run', async () => {
  let { g } = tracked()
  let where = dir()
  let seen: { bare?: boolean; persona?: string; cwd?: string; files?: number } =
    {}
  try {
    await g.apply([
      ...asking('S1', 'E1', 'write a pitch'),
      voiced('N1', 'Keep the graph true.'),
      { entity: { eid: 'S1' }, session: { persona: 'N1' } },
      { entity: { eid: 'E1' }, sending: { tools: [] } },
    ])
    await start(g, 'S1', {
      cwd: where,
      worktrees: `${where}/runs`,
      dir: where,
      poll: 5,
      launch: (store, spec, o) => {
        seen.cwd = spec.cwd
        seen.files = [...Deno.readDirSync(spec.cwd!)].length
        return launched(store, spec, o)
      },
      adapters: {
        fake: {
          ...fake,
          argv: (job) => {
            seen.bare = job.bare
            seen.persona = job.persona
            return fake.argv(job)
          },
        },
      },
    })
    await until(
      async () => comp((await said(g)).at(-1), 'stop'),
      'the bare run to end',
    )
    // No checkout was cut for it: it started where nothing is.
    assertEquals(seen.cwd, emptyOf('S1', { dir: where }))
    assertEquals([seen.bare, seen.files], [true, 0])
    assert(seen.persona?.includes('Keep the graph true.'))
    await until(() => !exists(seen.cwd!), 'its directory to be removed')
    assert(!exists(`${where}/runs/S1`))
  } finally {
    Deno.removeSync(where, { recursive: true })
  }
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

test('a claude run waits on its own background agents however long they take', async () => {
  let { g } = tracked()
  let where = dir()
  let env: Record<string, string> | undefined
  try {
    await g.apply(asking('S1', 'E1', 'do the thing'))
    await start(g, 'S1', {
      cwd: where,
      dir: where,
      poll: 5,
      env: { PATH: '/bin', CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS: '600000' },
      adapters: { fake },
      launch: (g, spec, o) => {
        env = spec.env
        return launched(g, spec, o)
      },
    })
    await until(
      async () => comp((await said(g)).at(-1), 'stop'),
      'the managed provider to exit',
    )
    assertEquals(env?.PATH, '/bin')
    assertEquals(env?.CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS, '0')
  } finally {
    Deno.removeSync(where, { recursive: true })
  }
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
// Two starts of one session, as two requests' effects make them, over a
// launch the test lends; `fail` is how many launches throw first.
let starting = async (fail = 0, more: Opts = {}) => {
  let { g } = tracked()
  let where = dir()
  let l = launching()
  let stop = new AbortController()
  let o: Opts = {
    cwd: where,
    dir: where,
    poll: 5,
    signal: stop.signal,
    adapters: { fake },
    launch: (...a) =>
      fail-- > 0 ? Promise.reject(new Error('no')) : l.launch(...a),
    ...more,
  }
  await g.apply(asking('S1', 'E1', 'do the thing'))
  let twice = () => Promise.allSettled([start(g, 'S1', o), start(g, 'S1', o)])
  return {
    g,
    started: l.started,
    twice,
    done: () => (stop.abort(), Deno.removeSync(where, { recursive: true })),
  }
}

test('a session two requests start at once launches once', async () => {
  let s = await starting()
  try {
    await s.twice()
    assertEquals(s.started.length, 1)
  } finally {
    s.done()
  }
})

test("a run goes without the servers named for its provider, not another's", async () => {
  let s = await starting(0, {
    adapters: { fake: { ...fake, argv: (j) => ['fake', ...j.without ?? []] } },
    without: { fake: ['drive'], codex: ['sentry'] },
  })
  try {
    await s.twice()
    assertEquals(s.started, [['fake', 'drive']])
  } finally {
    s.done()
  }
})

test('a launch that fails gives the session back for the next request', async () => {
  let s = await starting(1)
  try {
    await s.twice()
    assertEquals(s.started.length, 0)
    assertEquals(comp((await s.g.get(['S1']))[0], 'process'), undefined)
    await s.twice()
    assertEquals(s.started.length, 1)
  } finally {
    s.done()
  }
})

// A session whose run a watcher holds as `run` left it, the watcher being
// `P` as `p` describes it; then what one look of the duty did: the commands it
// launched, and the failures it told.
let P = crypto.randomUUID()
let OVER = { pid: 1, command: 'yak work' }
let READING = { pid: Deno.pid, roles: ['graph', 'effects'] }
let LEAVING = { pid: Deno.pid, roles: ['graph'] }
let look = async (
  run: Record<string, unknown>,
  p: Record<string, unknown>,
  ...rows: Bundle[]
) => {
  let { g } = tracked()
  let where = dir()
  let l = launching()
  let reports: string[] = []
  let stop = new AbortController()
  let o: Opts = {
    cwd: where,
    dir: where,
    poll: 5,
    signal: stop.signal,
    adapters: { fake },
    launch: l.launch,
    report: (e, c) => void reports.push(`${c?.tags?.step}: ${e}`),
  }
  await g.apply([
    ...asking('S1', 'E1', 'do the thing'),
    { entity: { eid: P }, process: p, ...p == OVER ? { exit: {} } : {} },
    { entity: { eid: 'S1' }, process: { watcher: P, ...run } },
    ...rows,
  ])
  let runs = await takeUp(g, o)
  let row = async () => (await g.get(['S1']))[0]
  return {
    g,
    o,
    runs,
    row,
    started: l.started,
    reports,
    // what the run's transcript ended with, once it has
    ending: () =>
      until(async () => {
        let last = (await said(g)).at(-1)
        return comp(last, 'stop') && String(comp(last, 'content')?.body)
      }, 'the ending'),
    done: () => (stop.abort(), Deno.removeSync(where, { recursive: true })),
  }
}

test('a start a process that is over cut off before its launch starts again', async () => {
  let s = await look({ cwd: '/w' }, OVER)
  try {
    let argv = await until(() => s.started[0], 'a launch')
    assert(argv.at(-1)!.includes('do the thing'), argv.join(' '))
    assertEquals(proc(await s.row())?.watcher, selfEid())
    assertEquals(s.reports, [])
  } finally {
    s.done()
  }
})

test('a start a process still makes is left to it, by a look and by a request', async () => {
  for (let p of [READING, LEAVING]) {
    let s = await look({ cwd: '/w' }, p)
    try {
      assertEquals(await start(s.g, 'S1', s.o), null)
      assertEquals([s.started, s.reports], [[], []])
    } finally {
      s.done()
    }
  }
})

test('a run whose watcher is leaving or over is taken up, and one still read is left', async () => {
  for (let [p, taken] of [[READING, false], [LEAVING, true], [OVER, true]]) {
    // launched, but its wrapper never reported a pid: over at once
    let s = await look({ command: 'fake' }, p as Record<string, unknown>)
    try {
      assertEquals(s.runs.length, taken ? 1 : 0)
      assertEquals(proc(await s.row())?.watcher, taken ? selfEid() : P)
      if (!taken) continue
      assertEquals(
        await s.ending(),
        'the provider never started: its wrapper reported no pid',
      )
      assert(s.reports.at(-1)?.startsWith('run ended: '), s.reports.join())
    } finally {
      s.done()
    }
  }
})

test('a session whose provider never began starts as a first run, told everything', async () => {
  let s = await look({ cwd: '/w' }, OVER, {
    entity: { eid: 'S1' },
    exit: {},
  }, {
    entity: { eid: 'E1:end' },
    entry: { session: 'S1' },
    ask: { through: 'E1' },
    stop: {},
    content: { body: 'the provider ended, and nobody saw how' },
    output: { source: 'S1' },
  }, {
    entity: { eid: 'E2' },
    entry: { session: 'S1' },
    content: { body: 'carry on' },
    using: FAKE,
  })
  try {
    // what the request `carry on` asks of its effect
    await start(s.g, 'S1', s.o)
    let [argv] = s.started
    let instruction = argv.at(-1)!
    assert(instruction.includes('do the thing'), instruction)
    assert(instruction.includes('carry on'), instruction)
    assert(!instruction.includes('nobody saw how'), instruction)
  } finally {
    s.done()
  }
})

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
