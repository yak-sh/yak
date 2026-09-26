// A managed session: the provider run as a detached command, its stdout read
// back into the graph as the transcript.
//
// Three facts hold it up, and two of them belong to other packages.
//
// 1. The child outlives US. @yaks/process owns that: a launcher that exits
//    immediately, a wrapper in a session of its own beyond the server's
//    service manager, a pidfile, and a file holding the exit code — enough
//    to pick the run back up later. The `process` component is stored on the
//    session's own entity: one entity, one run. Nothing here reaps child
//    processes.
// 2. The file is the log. The child's stdout is written to @yaks/process's
//    `<eid>.out` by the wrapper, and survives every restart of the server. The
//    graph stores the transcript read out of it by @yaks/session's importer,
//    the same one that reads an interactive harness's own transcript file:
//    each entry records the file and the line it came from, and the log how
//    many of its lines have been read, which is where a resume begins.
// 3. The request is an entry. A session asks for a provider, a model and an
//    effort through the `using` component on its first entry, and the text next
//    to it is the instruction. There is no HTTP endpoint that launches an agent
//    and no `launch` property: the transaction that writes that entry is the
//    request, and ./effects.ts is what answers it.
//
// Killing a run means writing a `stop` component on the session's own entity,
// next to its `process` — the same component @yaks/process reads next to a
// `service` row. A `stop` on an entry means something else: the end of a
// transcript. The two never conflict, because one is written on a session and
// the other on an entry.

import type { Bundle, Comp, Graph } from '@yaks/graph'
import { edgeEid } from '@yaks/edge'
import { type Reader, SESSION } from '@yaks/session'
import { pull, type Tail, tail } from '@yaks/session/tail'
import {
  EXIT,
  launch,
  paths,
  PROCESS,
  type Process,
  type Run,
  signal,
  store,
  watch,
} from '@yaks/process'
import { createWorktree, discover, reclaim } from '@yaks/git/host'
import { type Adapter, adapters as known, type Job } from './adapters.ts'

/** How a spawn runs, all optional. */
export type Opts = {
  /** the providers that are commands, by name (default the package's table) */
  adapters?: Record<string, Adapter>
  /** where the child runs (default this process's own cwd) — and, with
   * `worktrees`, the checkout each run's own is cut from */
  cwd?: string
  /** where each run gets a checkout of its own: `<worktrees>/<session>` on
   * branch `session-<session>`, cut from `cwd`'s HEAD and taken back when the
   * run ends unless it holds work, so two runs never write in one worktree
   * and no run writes in its launcher's */
  worktrees?: string
  /** the child's whole environment (default the server's own, since a
   * provider's subscription credentials are found through `HOME` and its CLI
   * through `PATH`) */
  env?: Record<string, string>
  /** where @yaks/process keeps its files (default its own rule) */
  dir?: string
  /** how often the log and the ending are read (ms, default 250) */
  poll?: number
  /** how long the wrapper has to report in (ms, @yaks/process default) */
  birth?: number
  /** how long a stopped run has after TERM before KILL (ms, default 10_000) */
  grace?: number
  /** mint an entry's eid (default a uuid) */
  mint?: () => string
  /** where a failure that has nobody to throw at goes */
  report?: (err: unknown) => void
  /** the host shutting down (@yaks/cli `Host.stopping`): a run's log is read
   * until the run is over or this aborts, so a tail never polls a graph that
   * has closed (default never) */
  signal?: AbortSignal
}

let uuid = () => crypto.randomUUID() as string
let sleep = (ms: number) => new Promise((go) => setTimeout(go, ms))
let told = (o: Opts) => o.report ?? ((err: unknown) => console.error(err))

let comp = (b: Bundle | undefined, name: string) =>
  b?.[name] as Comp | undefined

let one = async (g: Graph, eid: string): Promise<Bundle | undefined> =>
  (await g.get([eid]))[0]

/** What a session was asked for, as the graph holds it. */
export type Asked = Job & {
  /** the provider's name, which is what names an adapter */
  provider: string
  /** the ask a turn of this run answers (@yaks/session `ask`): the model
   * entity, and the request entry it was asked through */
  ask: Comp
}

// The efforts a model accepts, space- or comma-separated. An empty list allows
// anything: a provider with no effort setting cannot reject one.
let levels = (efforts: unknown): string[] =>
  String(efforts ?? '').split(/[\s,]+/).filter(Boolean)

/** What `provider` calls `model`: the name on its `serves` edge, or nothing
 * when the provider does not serve that model. */
export let spelling = async (
  g: Graph,
  provider: string,
  model: string,
): Promise<string | undefined> => {
  let [edge] = await g.get([edgeEid(provider, 'serves', model)])
  let name = comp(edge, 'serves')?.name
  return name == null ? undefined : String(name)
}

/**
 * Read a session's request out of its transcript: the `using` component on the
 * first entry that has one, and the instruction text stored with it.
 *
 * ```ts
 * import { asked } from '@yaks/spawn'
 *
 * // let job = await asked(graph, 'S-1…')
 * ```
 *
 * `null` when nothing asked for a provider — an ordinary transcript somebody
 * else is driving.
 */
export let asked = async (
  g: Graph,
  session: string,
): Promise<Asked | null> => {
  let entries = await g.read(`.entry.session=${session}&.order=entry.seq&*`)
  let request = entries.find((b) => b.using)
  if (!request) return null
  let using = comp(request, 'using')!
  if (!using.provider) return null
  let [provider, model] = await g.get([
    String(using.provider),
    String(using.model ?? ''),
  ])
  let name = String(comp(provider, 'provider')?.name ?? '')
  if (!name) return null
  let served = comp(model, 'model')
  let spelled = served
    ? await spelling(g, String(using.provider), String(using.model))
    : undefined
  if (served && spelled == null) {
    throw new Error(`${name} does not serve ${String(served.name)}`)
  }
  let effort = String(using.effort ?? served?.effort ?? '')
  let admits = levels(served?.efforts)
  if (effort && admits.length && !admits.includes(effort)) {
    throw new Error(
      `unknown effort: ${effort} — ${name} serves ${admits.join(', ')}`,
    )
  }
  // The instruction is the prose the request came with; a request stated on an
  // entry of its own takes the transcript's first input instead.
  let input = entries.find((b) => b.content && !b.output)
  let said = comp(request, 'content') ?? comp(input, 'content')
  return {
    provider: name,
    session,
    model: spelled,
    effort: effort || undefined,
    instruction: String(said?.body ?? ''),
    ask: {
      ...served ? { to: String(using.model) } : {},
      through: request.entity.eid,
    },
  }
}

// A turn's ending carries what it cost, and says which ask it answers the way
// a daemon's ask entry does, so whatever reads usage off `ask` rows
// (@yaks/session `transcriptUsage`) reads a run's too.
let answering = (read: Reader, ask: Comp): Reader => (e) => {
  let said = read(e)
  return {
    ...said,
    entries: said.entries.map((c) => c.usage ? { ...c, ask } : c),
  }
}

/**
 * Read a run's log into its transcript until the run is over.
 *
 * ```ts
 * import { adapters, follow } from '@yaks/spawn'
 *
 * // await follow(graph, session, adapters.claude.read)
 * ```
 *
 * It resumes where the transcript stands, so the same call serves a fresh
 * launch and a run adopted back after a restart; and it reads the ending
 * before the last bytes, so nothing written just before an exit is lost. A
 * pass that fails (a store that stayed locked past its busy timeout) is told,
 * and the next opens the tail again where the transcript stands: a failure
 * costs a pause, never the rest of the run.
 */
export let follow = async (
  g: Graph,
  session: string,
  read: Reader,
  o: Opts = {},
): Promise<void> => {
  let poll = o.poll ?? 250
  let t: Tail | undefined
  while (!o.signal?.aborted) {
    let wait = poll
    try {
      t ??= await tail(g, paths(session, o).out, { session })
      let over = comp(await one(g, session), EXIT) != null
      await pull(g, t, read, { final: over, report: told(o) })
      if (over) return ended(g, session, o)
    } catch (e) {
      told(o)(e)
      t = undefined
      wait = poll * 20
    }
    await sleep(wait)
  }
}

/** Where a run's own checkout is, under `worktrees`. */
export let checkoutOf = (session: string, worktrees: string): string =>
  `${worktrees}/${session}`

// A run's own checkout, cut from the source checkout's HEAD on a branch named
// after the session. Committed work only: what is uncommitted in the source
// stays there.
let cut = async (g: Graph, session: string, o: Opts): Promise<string> => {
  let tree = await createWorktree(g, o.cwd ?? Deno.cwd(), {
    path: checkoutOf(session, o.worktrees!),
    branch: `session-${session}`,
  })
  return String(comp(tree, 'worktree')?.path)
}

/** The environment a run speaks in: the one it was given, with the session
 * that launched it taken out and this run's own named. A variable naming the
 * launcher's session would sign the run's writes as the launcher's (@yaks/cli
 * `via`); a harness that sets its own for its children still does. */
export let speaking = (
  session: string,
  env: Record<string, string>,
): Record<string, string> => {
  let {
    CLAUDE_CODE_SESSION_ID: _claude,
    CODEX_THREAD_ID: _codex,
    TASKS_SESSION: _tasks,
    ...rest
  } = env
  return { ...rest, TASKS_SESSION: session }
}

/**
 * Start a session's provider and read its output back into the transcript.
 *
 * ```ts
 * import { start } from '@yaks/spawn'
 *
 * // let run = await start(graph, session)
 * ```
 *
 * `null` when this session asked for nothing, or asked for a provider this
 * package has no adapter for: it launches command-line agents only, and a
 * provider a host lends a model for is the session runner's (@yaks/session
 * `running`). The tail keeps running after this call returns: what it returns
 * is the started process, not the finished run.
 */
export let start = async (
  g: Graph,
  session: string,
  o: Opts = {},
): Promise<Run | null> => {
  let job = await asked(g, session)
  if (!job) return null
  let adapter = (o.adapters ?? known)[job.provider]
  if (!adapter) return null
  let argv = adapter.argv(job)
  let run = await launch(store(g), {
    command: argv[0],
    args: argv.slice(1),
    cwd: o.worktrees ? await cut(g, session, o) : o.cwd,
    env: speaking(session, o.env ?? Deno.env.toObject()),
  }, {
    ...o,
    eid: session, // one entity: the transcript is the thing running
    stream: false, // the lines are entries, not anonymous output
  })
  follow(g, session, answering(adapter.read, job.ask), o).catch(told(o))
  return run
}

/**
 * Pick every managed session back up. Call it once at start-up, before
 * serving: a run still going is watched again and its log read on from where
 * the transcript stands; one that ended while we were away is stamped now, and
 * the lines it wrote in between are imported in the same pass. So is a run
 * that ended while nobody was reading its log, whose transcript still reads
 * as going: it is read to its end, and its ending written.
 *
 * ```ts
 * import { resume } from '@yaks/spawn'
 *
 * // let runs = await resume(graph)
 * ```
 */
export let resume = async (g: Graph, o: Opts = {}): Promise<Run[]> => {
  // Narrowing the store is the seam @yaks/process already offers: here
  // `running` returns only the sessions that are running, so the shell's own
  // child processes stay the shell's to watch.
  let mine = {
    ...store(g),
    running: () => g.read(`.${SESSION}&.${PROCESS}&!${EXIT}&*`),
  }
  let runs = await watch(mine, o)
  // The watch's own loop outlives this call and nobody awaits it, so its
  // failure is told rather than thrown at nobody — a process that let the
  // graph go while a tail was still polling is the ordinary way this ends.
  for (let run of runs) run.done.catch(told(o))
  // A run asked here that is over, but whose transcript has no ending, was
  // left unread partway.
  let sessions = async (q: string) =>
    new Set(
      (await g.rows(`${q}&.tally=entry.session`)).map((r) => String(r.value)),
    )
  let [asks, over] = await Promise.all([sessions('.using'), sessions('.stop')])
  let unread = (await g.read(`.${SESSION}&.${PROCESS}&.${EXIT}`))
    .map((b) => b.entity.eid)
    .filter((eid) => asks.has(eid) && !over.has(eid))
  for (let eid of [...runs.map((r) => r.eid), ...unread]) {
    let job = await asked(g, eid).catch(() => null)
    let adapter = job && (o.adapters ?? known)[job.provider]
    if (job && adapter) {
      follow(g, eid, answering(adapter.read, job.ask), o).catch(told(o))
    }
  }
  return runs
}

// A run that ended without saying so. A provider prints a terminal event when
// it finishes a turn; one that was killed, crashed, or simply stopped talking
// prints nothing, and a transcript whose newest line is a `say` reads as
// running forever. So the ending is written down — the process ending is
// observed, not inferred from the conversation, which is the difference
// between evidence and a guess.
let ended = async (g: Graph, session: string, o: Opts): Promise<void> => {
  if (o.worktrees) await taken(g, checkoutOf(session, o.worktrees))
  let [said] = await g.read(`.stop&.entry.session=${session}&.limit=1`)
  if (said) return
  let code = comp(await one(g, session), EXIT)?.code
  await g.apply([{
    entity: { eid: (o.mint ?? uuid)() },
    entry: { session },
    stop: {},
    ...(code === 0 ? {} : {
      error: { code: 'exit' },
      content: {
        body: code == null
          ? 'the provider ended, and nobody saw how'
          : `the provider exited ${code}`,
      },
      output: { source: session },
    }),
  }], { trusted: true })
}

// A run's checkout, taken back now that the run is over — its row brought up
// to date first, so a resume can create it again where it stood. One that
// holds work (uncommitted, or commits nothing has landed) is kept.
let taken = async (g: Graph, path: string): Promise<void> => {
  try {
    await Deno.stat(path)
  } catch {
    return
  }
  await discover(g, path).catch(() => {})
  await reclaim(path)
}

/**
 * Take a run down: TERM its process group, then KILL what is still there after
 * the grace. The ending is stamped by whoever is watching it, here as
 * everywhere — this only asks.
 *
 * ```ts
 * import { down } from '@yaks/spawn'
 *
 * // await down(graph, session)
 * ```
 */
export let down = async (
  g: Graph,
  session: string,
  o: Opts = {},
): Promise<void> => {
  let over = async () => comp(await one(g, session), EXIT) != null
  let pid = Number(
    (comp(await one(g, session), PROCESS) as Process | undefined)?.pid ?? 0,
  )
  if (!pid || await over()) return
  await signal(session, pid, 'TERM', o)
  for (let end = Date.now() + (o.grace ?? 10_000); Date.now() < end;) {
    if (await over()) return
    await sleep(o.poll ?? 250)
  }
  await signal(session, pid, 'KILL', o)
}
