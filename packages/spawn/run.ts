import * as disk from '@yaks/file/io'
import * as system from '@yaks/process/system'
// A managed session: the provider run as a detached command, its stdout read
// back into the graph as the transcript.
//
// Three facts hold it up, and two of them belong to other packages.
//
// 1. The child outlives US. @yaks/process owns that: a launcher that exits
//    immediately, a wrapper in a session of its own beyond the server's
//    service manager, a pidfile, and a file holding the exit code — enough
//    to pick the run back up later. The `process` component is stored on the
//    session's own entity: one entity, one run at a time. Nothing here reaps
//    child processes. Its `watcher` is the process that took the session for
//    the run and reads it; once that one is over or leaving, the duty takes
//    the run up, and starts again a run it never launched (`takeUp`), so a
//    restart that lands while a run starts costs a moment, not the run.
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
//    request, and ./effects.ts is what answers it. A request written after a
//    run ended starts the next run on the provider's own thread, given what
//    was said since; so does one written while it ran, as it ends.
//
// A run that ends cleanly while the task it holds waits on a dependency is
// parked there (@yaks/session `waits`): it keeps its claim, its checkout and
// its log, and the dependency finishing asks for its next run
// (`session_wake`), as does one that finished while it ran (`rouse`, as it
// ends).
//
// A run starts with its selected persona, or else the common persona of the
// work it holds a claim on, which for a sub-project's task is its own and each
// one above it (@yaks/persona `owed`). It goes through the provider's
// instruction flag, unless the instruction file the provider reads there
// already says it: a run's own worktree has the repository's AGENTS.md link but
// not the ignored directory it points into. What it was given is snapshotted into its
// transcript as an instruction entry (@yaks/context), the same record a
// session the harness opens carries.
//
// Killing a run means writing a `stop` component on the session's own entity,
// next to its `process` — the same component @yaks/process reads next to a
// `service` row. A `stop` on an entry means something else: the end of a
// transcript. The two never conflict, because one is written on a session and
// the other on an entry.

import type { Bundle, Comp, Graph } from '@yaks/graph'
import { Stale } from '@yaks/graph/errors'
import { derivedEid } from '@yaks/graph/identity'
import { token } from '@yaks/graph/sha256'
import { edgeEid } from '@yaks/edge'
import {
  CLAIM,
  cleanEnd,
  firstInput,
  firstRequest,
  latestRequest,
  parked,
  type Reader,
  receiptOf,
  requested,
  rouse,
  SESSION,
  sessionEnv,
  told as everything,
  unanswered,
} from '@yaks/session'
import { pull, recount, type Tail, tail } from '@yaks/session/tail'
import { kept } from '@yaks/session/service'
import {
  clean,
  EXIT,
  gone,
  launch,
  paths,
  PROCESS,
  type Process,
  type Run,
  selfEid,
  signal,
  store,
  watch,
} from '@yaks/process'
import { retained } from '@yaks/git/workspace'
import {
  createWorktree,
  discover,
  keepSpare,
  locate,
  reclaim,
} from '@yaks/git/host'
import { owed } from '@yaks/persona'
import { promptEntry, snapshot } from '@yaks/context'
import { type Adapter, adapters as known, type Job } from './adapters.ts'
import { complete } from './completion.ts'

/** How a spawn runs, all optional. */
export type Opts = {
  /** the providers that are commands, by name (default the package's table) */
  adapters?: Record<string, Adapter>
  /** where the child runs (default this process's own cwd) — and, with
   * `worktrees`, the checkout each run's own is cut from */
  cwd?: string
  /** where each run gets a checkout of its own: `<worktrees>/<session>` on
   * branch `session-<session>`, cut from main and taken back when the
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
  /** the MCP servers each run is connected to, by name to URL, each told the
   * run's session in `x-via` so the server stamps its writes with the
   * session's actor (./adapters.ts `Job.mcp`) */
  mcp?: Record<string, string>
  /** the MCP servers of a provider's own configuration its runs go without,
   * by the provider's name and then the names that provider lists them under
   * (./adapters.ts `Job.without`) */
  without?: Record<string, string[]>
  /** how a command is started (default @yaks/process `launch`): the one
   * place a run touches the machine's processes, so a host that starts them
   * another way, or a test that starts none, lends its own */
  launch?: typeof launch
  /** mint an entry's eid (default a uuid) */
  mint?: () => string
  /** where a failure that has nobody to throw at goes: the host's tracker
   * (@yaks/cli `Host.report`), else the console */
  report?: Report
  /** the host shutting down (@yaks/cli `Host.stopping`): a run's log is read
   * until the run is over or this aborts, so a tail never polls a graph that
   * has closed (default never) */
  signal?: AbortSignal
}

/** Where a failure is told, with what it happened to (@yaks/tracker
 * `Context`). */
export type Report = (
  err: unknown,
  context?: {
    tags?: Record<string, string>
    during?: { session?: string }
  },
) => unknown

let sleep = (ms: number) => new Promise((go) => setTimeout(go, ms))
let told = (o: Opts): Report =>
  o.report ?? ((err, context) => console.error(err, context ?? ''))

// A failure that happened to a session's run, told where it is seen (M-37965).
let failure = (o: Opts, session: string, step: string, message: string) =>
  void Promise.resolve(
    told(o)(new Error(message), {
      tags: { package: '@yaks/spawn', step },
      during: { session },
    }),
  ).catch(() => {})

let comp = (b: Bundle | undefined, name: string) =>
  b?.[name] as Comp | undefined

let one = async (
  g: Graph,
  eid: string,
  comps?: string[],
): Promise<Bundle | undefined> => (await g.get([eid], comps))[0]

// How a session's run stands: its process, how it exited, and whether it was
// asked to stop. Read alone wherever a run is watched: the rest a session
// wears (its computed status and cost) reads every entry of its transcript.
let ran = (g: Graph, session: string) =>
  one(g, session, [PROCESS, EXIT, 'stop'])

let proc = (row: Bundle | undefined) =>
  comp(row, PROCESS) as Process | undefined

// A run going: launched (it has a pid, or the command line of a wrapper that
// never reported one) and not over.
let going = (row: Bundle | undefined): boolean => {
  let p = proc(row)
  return !!p && row![EXIT] == null && (p.pid != null || p.command != null)
}

// A session taken for its next run that has not launched it: the row a take
// writes, before a launch gives it a pid and a command line.
let unlaunched = (row: Bundle | undefined): boolean => {
  let p = proc(row)
  return !!p && row![EXIT] == null && p.pid == null && p.command == null
}

/** How the process watching a run stands: this one (`self`); another that
 * still works the effects, whose tails go on (`reading`); one alive but
 * leaving, which gave that role up as its tails stopped (`leaving`,
 * @yaks/cli `retire`); or one that is over, or that nobody recorded
 * (`over`). */
export type Watcher = 'self' | 'reading' | 'leaving' | 'over'

export let watcherOf = async (
  g: Graph,
  row: Bundle | undefined,
): Promise<Watcher> => {
  let w = proc(row)?.watcher
  if (w == null) return 'over'
  let me = selfEid()
  if (w == me) return 'self'
  if (await gone(store(g), String(w), { me })) return 'over'
  let roles = proc((await g.get([String(w)], [PROCESS]))[0])?.roles
  return Array.isArray(roles) && !roles.includes('effects')
    ? 'leaving'
    : 'reading'
}

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

/** An entry that asks for a managed turn. Imported selections and served
 * asks describe history; neither requests another process. */
export let requestOf = (b: Bundle | undefined): Bundle | undefined =>
  b?.entry && b.using && !b.lines && !b.ask ? b : undefined

/**
 * Read a session's request out of its transcript: the `using` component on the
 * first entry that has one, and the instruction text stored with it. A request
 * that names a provider alone runs the model on the provider's own
 * `using{model}`, so the run is told its model and its asks name it; a CLI
 * left to its own default reports no model to price.
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
  let [owner] = await g.get([session])
  if (owner?.native) return null
  let request = await firstRequest(g, session)
  if (!request) return null
  let using = comp(request, 'using')!
  if (!using.provider) return null
  let [provider] = await g.get([String(using.provider)])
  let name = String(comp(provider, 'provider')?.name ?? '')
  if (!name) return null
  let chosen = String(using.model ?? comp(provider, 'using')?.model ?? '')
  let [model] = chosen ? await g.get([chosen]) : []
  let served = comp(model, 'model')
  let spelled = served
    ? await spelling(g, String(using.provider), chosen)
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
  let said = comp(request, 'content') ??
    comp(await firstInput(g, session), 'content')
  return {
    provider: name,
    session,
    model: spelled,
    effort: effort || undefined,
    instruction: String(said?.body ?? ''),
    ask: {
      ...served ? { to: chosen } : {},
      through: request.entity.eid,
    },
  }
}

// What a run used says which ask it answers the way a daemon's ask entry
// does, so whatever reads usage off `ask` rows (@yaks/session
// `transcriptUsage`) reads a run's too. A request the log names keeps its own
// id and model.
let answering = (read: Reader, ask: Comp): Reader => (e) => {
  let said = read(e)
  return {
    ...said,
    entries: said.entries.map((c) =>
      c.usage ? { ...c, ask: { ...ask, ...c.ask } } : c
    ),
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
 * costs a pause, never the rest of the run. A run that a later one has taken
 * the session over from is left to the later one's reader.
 */
export let follow = async (
  g: Graph,
  session: string,
  read: Reader,
  o: Opts = {},
  run: Attempt = {},
): Promise<void> => {
  let poll = o.poll ?? 250
  let t: Tail | undefined = run.tail
  while (!o.signal?.aborted) {
    let wait = poll
    try {
      t ??= await tail(g, paths(session, o).out, { session })
      let row = await ran(g, session)
      let over = comp(row, EXIT) != null
      await pull(g, t, read, { final: over, report: told(o) })
      if (over) {
        let now = await ran(g, session)
        let pid = (b?: Bundle) => comp(b, PROCESS)?.pid
        if (comp(now, EXIT) == null || pid(now) != pid(row)) return
        // A run handed to another process (this one leaving, at a restart) is
        // finished by its new watcher alone: two taking its checkout back at
        // once each pull files from under the other.
        let watcher = proc(now)?.watcher
        if (watcher != null && watcher != selfEid()) return
        let well = await finish(g, session, o, run.through)
        if (well != null) {
          await onward(g, session, o, well).catch(told(o))
          return
        }
        wait = poll * 20
      }
    } catch (e) {
      told(o)(e)
      t = undefined
      wait = poll * 20
    }
    await sleep(wait)
  }
}

/** One run of a session, as its reader needs it. */
export type Attempt = {
  /** the request entry it answers (@yaks/session `ask.through`), whose stop
   * says the run ended; where unknown, the newest request */
  through?: string
  /** the tail on its log, placed before it wrote a line */
  tail?: Tail
}

/** Where a run's own checkout is, under `worktrees`. */
export let checkoutOf = (session: string, worktrees: string): string =>
  `${worktrees}/${session}`

// A run's own checkout, cut from main on a branch named
// after the session. Committed work only: what is uncommitted in the source
// stays there.
let cut = async (g: Graph, session: string, o: Opts): Promise<string> => {
  let tree = await createWorktree(g, o.cwd ?? system.cwd(), {
    path: checkoutOf(session, o.worktrees!),
    branch: `session-${session}`,
    base: 'refs/heads/main',
    spare: true,
  })
  return String(comp(tree, 'workspace')?.root)
}

// A file's text, or nothing where there is none: a link that dangles is no
// file.
let text = (path: string): Promise<string | undefined> =>
  disk.readTextFile(path).catch((e) => {
    if (e instanceof disk.errors.NotFound) return undefined
    throw e
  })

// The persona a run in `checkout` is given beside the file its provider reads
// there, snapshotted into its transcript where the graph keeps instruction
// snapshots.
let given = async (
  g: Graph,
  session: string,
  checkout: string,
  adapter: Adapter,
): Promise<string | undefined> => {
  let found = adapter.file ? await text(`${checkout}/${adapter.file}`) : null
  let selected = comp(await one(g, session), SESSION)?.persona
  let [work] = (await g.read(`.${CLAIM}.session=${JSON.stringify(session)}`))
    .map((b) => b.entity.eid).sort()
  let owes = await owed(g, checkout, found == null ? [] : [found], {
    persona: selected == null ? undefined : String(selected),
    work,
  })
  if (!owes) return undefined
  if (g.vocab.comp('prompt')) {
    let s = await snapshot(owes.text, owes.source)
    await g.apply([
      promptEntry(session, undefined, s.body, s.source, 'shared', s.revision),
    ])
  }
  return owes.text
}

/** Carry a session's job onto its next run: on the same provider thread,
 * given what it was told since its last run (@yaks/session `unanswered`); or,
 * for a session whose provider never began a thread, as a first run given
 * everything it was told (@yaks/session `told`). The caller supplies the
 * current session and that transcript. A run still going carries nothing;
 * starting the command must still take the session before it launches. */
export let carry = (
  row: Bundle,
  job: Asked,
  said: Bundle[],
): Asked | null => {
  let thread = comp(row, SESSION)?.id
  if (row.stop || going(row) || !said.some(requestOf)) return null
  return {
    ...job,
    ...since(said, job),
    ...thread == null ? {} : { thread: String(thread) },
  }
}

/**
 * Start a session's provider, with the persona its checkout is owed, and read
 * its output back into the transcript.
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
  let row = await one(g, session)
  if (row?.stop || going(row)) return null
  let job = await asked(g, session)
  if (!job) return null
  let adapter = (o.adapters ?? known)[job.provider]
  if (!adapter) return null
  if (row?.[PROCESS]) {
    // A session that ran before carries on its provider's thread, given what
    // it was told since. One whose start was cut off before its provider
    // began a thread begins now, given everything it was told.
    if (!await requested(g, session)) return null
    let thread = comp(row, SESSION)?.id
    let said = thread == null
      ? await everything(g, session)
      : await unanswered(g, session)
    let carried = carry(row, job, said)
    if (!carried) return null
    job = carried
  }
  let home = o.worktrees ? checkoutOf(session, o.worktrees) : o.cwd
  if (!await take(g, session, row, home ?? system.cwd())) return null
  let run: Run
  let t: Tail
  try {
    let cwd = o.worktrees ? await cut(g, session, o) : o.cwd
    let persona = await given(g, session, cwd ?? system.cwd(), adapter)
    let argv = adapter.argv({
      ...job,
      persona,
      mcp: o.mcp,
      without: o.without?.[job.provider],
    })
    // Placed before the child writes a line: a log cleaned since the last run
    // is new, and its lines are numbered on from where the transcript stands.
    t = await tail(g, paths(session, o).out, { session })
    run = await (o.launch ?? launch)(store(g), {
      command: argv[0],
      args: argv.slice(1),
      cwd,
      env: sessionEnv(session, {
        ...o.env ?? system.env.toObject(),
        ...adapter.env,
      }),
    }, {
      ...o,
      eid: session, // one entity: the transcript is the thing running
    })
  } catch (e) {
    await g.apply([{ entity: { eid: session }, ...held(row) }])
    throw e
  }
  // A stop can land while the wrapper starts, before its process row exists.
  // The stop effect had no pid then; now that launch has stamped one, answer it.
  if ((await ran(g, session))?.stop) down(g, session, o).catch(told(o))
  // The next run's checkout is made from a spare in about a second, where one
  // cut whole takes several: one is cut once this run has launched.
  if (o.worktrees) {
    keepSpare(
      o.cwd ?? system.cwd(),
      checkoutOf(session, o.worktrees),
      'refs/heads/main',
    )
      .catch(told(o))
  }
  let through = String(job.ask.through)
  follow(g, session, answering(adapter.read, job.ask), o, { through, tail: t })
    .catch(told(o))
  return run
}

// The run a session's row records, as it was read.
let held = (row: Bundle | undefined) => ({
  [PROCESS]: comp(row, PROCESS) ?? null,
  [EXIT]: comp(row, EXIT) ?? null,
})

// Take a session for its next run before anything is cut or launched: one
// write guarded on the run its row records as read (none yet, one that ended,
// or a take whose process is over before it launched), which it replaces with
// a run that has no pid yet and this process as its watcher. Of two requests
// that read the same row, one takes it and the other is refused, so a session
// launches once however many requests arrive while it starts; a wake landing
// meanwhile is refused rather than missed (@yaks/session `rouse`), and the run
// reads it with the rest. A run still going is not taken, nor is a take a
// process that is not over may still launch.
let take = async (
  g: Graph,
  session: string,
  row: Bundle | undefined,
  cwd: string,
): Promise<boolean> => {
  if (going(row)) return false
  if (unlaunched(row) && await watcherOf(g, row) != 'over') return false
  let was = held(row)
  let p = (was[PROCESS] ?? {}) as Process
  try {
    await g.apply([{
      entity: { eid: session },
      // Every claim writes over a value the last one left: a first run's
      // `cwd`, a later run's `command`, which only a launch writes.
      [PROCESS]: { pid: null, command: null, cwd, watcher: selfEid() },
      [EXIT]: null,
      brief: null,
      $was: {
        [EXIT]: { code: token(was[EXIT]?.code) },
        [PROCESS]: {
          pid: token(p.pid),
          command: token(p.command),
          cwd: token(p.cwd),
          watcher: token(p.watcher),
        },
      },
    }])
    return true
  } catch (e) {
    if (e instanceof Stale) return false
    throw e
  }
}

// What a run that carries on is given: everything said to the session since
// its last run was (@yaks/session `unanswered`), and the newest of it as the
// request its turns answer.
let since = (
  said: Bundle[],
  job: Asked,
): Pick<Asked, 'instruction' | 'ask'> => {
  return {
    instruction: said.map((b) => String(comp(b, 'content')?.body ?? ''))
      .join('\n\n'),
    ask: { ...job.ask, through: said.at(-1)!.entity.eid },
  }
}

/** Finish a managed turn and tell it about dependencies completed during
 * the run. Called only after its final log bytes have been imported. */
export let finish = async (
  g: Graph,
  session: string,
  o: Opts = {},
  through?: string,
): Promise<boolean | undefined> => {
  await ended(g, session, o, through)
  try {
    let well = cleanEnd(await ran(g, session))
    if (well) await rouse(g, session)
    await complete(g, session)
    return well
  } catch (e) {
    told(o)(e)
    return undefined
  }
}

// After a run: one that ended cleanly is told now of a dependency that
// finished while it ran (@yaks/session `rouse`), and what was said to it
// meanwhile starts its next run. One parked keeps its checkout and its files,
// for its next run to carry on in and append to (@yaks/process `sweep` takes
// the files in a day); every other run's are taken back.
let onward = async (
  g: Graph,
  session: string,
  o: Opts,
  well: boolean,
): Promise<void> => {
  if (!well || !await parked(g, session)) {
    if (o.worktrees) await taken(g, checkoutOf(session, o.worktrees))
    clean(session, o)
  }
  if (well && await requested(g, session)) await start(g, session, o)
}

// Read a run's log on, from where its transcript stands, against the request
// in force: the newest, which is what the run being read answers.
let readOn = async (g: Graph, session: string, o: Opts): Promise<void> => {
  let job = await asked(g, session).catch(() => null)
  let adapter = job && (o.adapters ?? known)[job.provider]
  let request = await latestRequest(g, session)
  if (job && adapter) {
    let ask = { ...job.ask, through: request?.entity.eid ?? job.ask.through }
    follow(g, session, answering(adapter.read, ask), o, {
      through: String(ask.through),
    }).catch(told(o))
  }
}

/**
 * Take up every managed run nobody reads, and start again every start cut off
 * before its launch. A run going whose watcher is over, or leaving, is this
 * process's from now on: its watcher, its pid watched and its log read on
 * from where the transcript stands. A start a process that is over never
 * launched is started again, given what the session was told: a process
 * ending with a start half made is what a restart does, and starting it again
 * is its recovery, so nothing is told unless the start again fails. What
 * another process still reads, or still starts, is left to it, for
 * the next look. The duty looks once as it starts ({@link resume}) and again
 * every so often after (@yaks/spawn/service).
 *
 * ```ts
 * import { takeUp } from '@yaks/spawn'
 *
 * // let runs = await takeUp(graph)
 * ```
 */
export let takeUp = async (g: Graph, o: Opts = {}): Promise<Run[]> => {
  let me = selfEid()
  let mine: Bundle[] = []
  // Many runs share a watcher, and asking after one starts a process.
  let looked = new Map<unknown, Promise<Watcher>>()
  for (let row of await g.read(`.${SESSION}&.${PROCESS}&!${EXIT}&*`)) {
    let w = proc(row)?.watcher
    if (!looked.has(w)) looked.set(w, watcherOf(g, row))
    let watcher = await looked.get(w)!
    if (unlaunched(row)) {
      if (watcher == 'over') again(g, row, o).catch(told(o))
      continue
    }
    if (watcher == 'self' || watcher == 'reading') continue
    // One write guarded on the watcher as read, so of two processes taking
    // the same run up, one reads it.
    try {
      await g.apply([{
        entity: { eid: row.entity.eid },
        [PROCESS]: { watcher: me },
        $was: { [PROCESS]: { watcher: token(proc(row)?.watcher) } },
      }])
      mine.push(row)
    } catch (e) {
      if (!(e instanceof Stale)) throw e
    }
  }
  // Narrowing the store is the seam @yaks/process already offers: here
  // `running` returns only the runs taken up, so the shell's own child
  // processes stay the shell's to watch.
  let runs = await watch({ ...store(g), running: () => mine }, o)
  // The watch's own loop outlives this call and nobody awaits it, so its
  // failure is told rather than thrown at nobody — a process that let the
  // graph go while a tail was still polling is the ordinary way this ends.
  for (let run of runs) {
    run.done.catch(told(o))
    await readOn(g, run.eid, o)
  }
  return runs
}

// A start cut off before its launch, by a process that is over: started
// again. One with nothing left to start (asked to stop meanwhile, or a request
// this host has no provider for) is let go, so it no longer reads as running.
let again = async (g: Graph, row: Bundle, o: Opts): Promise<void> => {
  let session = row.entity.eid
  if (await start(g, session, o)) return
  try {
    await g.apply([{
      entity: { eid: session },
      [EXIT]: {},
      $was: {
        [EXIT]: { code: token(undefined) },
        [PROCESS]: { watcher: token(proc(row)?.watcher) },
      },
    }])
  } catch (e) {
    if (e instanceof Stale) return
    throw e
  }
  // Its transcript is ended the way any run's is, saying it never started.
  await readOn(g, session, o)
}

/**
 * Pick every managed session back up. Call it once at start-up, before
 * serving: every run nobody reads is taken up ({@link takeUp}); one that ended
 * while we were away is stamped now, and the lines it wrote in between are
 * imported in the same pass. So is a run that ended while nobody was reading
 * its log, whose transcript still reads as going: it is read to its end, and
 * its ending written.
 *
 * ```ts
 * import { resume } from '@yaks/spawn'
 *
 * // let runs = await resume(graph)
 * ```
 */
export let resume = async (g: Graph, o: Opts = {}): Promise<Run[]> => {
  let runs = await takeUp(g, o)
  // A run asked here that is over, but whose request has no ending after it,
  // was left unread partway. Each run asks once and ends once, so a session
  // with more requests than stops is looked at.
  let counts = async (q: string) =>
    new Map(
      (await g.rows(`${q}&.tally=entry.session`))
        .map((r) => [String(r.value), Number(r.n)]),
    )
  let [asks, over] = await Promise.all([
    counts('.using&!ask'),
    counts('.stop'),
  ])
  // A provider can print its stop before the process exits. Logs remain
  // until final import and completion succeed, so those left on disk also
  // need a final pass. Cleaned historical runs owe no new notification.
  let logs = new Set<string>()
  let dir = paths('', o).out.replace(/\/[^/]*$/, '')
  try {
    for await (let file of disk.readDir(dir)) {
      if (file.isFile && file.name.endsWith('.out')) {
        logs.add(file.name.slice(0, -4))
      }
    }
  } catch (error) {
    if (!(error instanceof disk.errors.NotFound)) throw error
  }
  let read = new Set(runs.map((r) => r.eid))
  let unread = (await g.read(`.${SESSION}&.${PROCESS}&.${EXIT}`))
    .map((b) => b.entity.eid)
    .filter((eid) =>
      !read.has(eid) &&
      ((asks.get(eid) ?? 0) > (over.get(eid) ?? 0) || logs.has(eid))
    )
  for (let eid of unread) await readOn(g, eid, o)
  return runs
}

// A run that ended without saying so. A provider prints a terminal event when
// it finishes a turn; one that was killed, crashed, or simply stopped talking
// prints nothing, and a transcript whose newest line is a `say` reads as
// running forever. So the ending is written down — the process ending is
// observed, not inferred from the conversation, which is the difference
// between evidence and a guess. A run said it ended when the request it
// answered has a stop after it.
let ended = async (
  g: Graph,
  session: string,
  o: Opts,
  through?: string,
): Promise<void> => {
  let [stop, request] = await Promise.all([
    receiptOf(g, session),
    through ? one(g, through) : latestRequest(g, session),
  ])
  let seq = (b?: Bundle) => Number(comp(b, 'entry')?.seq ?? 0)
  if (stop && seq(stop) > seq(request)) return
  let row = await ran(g, session)
  let code = comp(row, EXIT)?.code as number | null | undefined
  let why = code === 0 ? '' : await cause(session, row, o)
  await g.apply([{
    entity: {
      eid: (o.mint ?? (() =>
        derivedEid(`spawn ending ${session} ${request?.entity.eid ?? ''}`)))(),
    },
    entry: { session },
    ...request ? { ask: { through: request.entity.eid } } : {},
    stop: {},
    ...(code === 0 ? {} : {
      failed: {
        reason: code == null
          ? 'Provider exit was not observed'
          : `Provider exited ${code}`,
      },
      content: { body: why },
      output: { source: session },
    }),
  }], { trusted: true })
  // A run nobody asked to stop that ended any way but cleanly is a failure,
  // told where it is seen.
  if (code !== 0 && !row?.stop) {
    failure(o, session, 'run ended', `a spawned run ended: ${why}`)
  }
}

// The signals a provider is commonly ended by, by number: a wrapper's `wait`
// answers 128 plus the signal for a child a signal ended.
let SIGNALS: Record<number, string> = {
  1: 'SIGHUP',
  2: 'SIGINT',
  3: 'SIGQUIT',
  6: 'SIGABRT',
  9: 'SIGKILL',
  11: 'SIGSEGV',
  13: 'SIGPIPE',
  15: 'SIGTERM',
}

// How a run ended, as its row and its files show it: the code its wrapper
// wrote, the signal that code names, or why there is none; then the last line
// it printed on stderr, which is where a provider says what went wrong.
let cause = async (
  session: string,
  row: Bundle | undefined,
  o: Opts,
): Promise<string> => {
  let code = comp(row, EXIT)?.code as number | null | undefined
  let signal = code != null && code > 128 ? SIGNALS[code - 128] : undefined
  let f = paths(session, o)
  let reported = proc(row)?.pid != null ||
    await disk.stat(f.pid).then(() => true, () => false)
  let how = code != null
    ? signal
      ? `the provider was ended by ${signal} (exit ${code})`
      : `the provider exited ${code}`
    : reported
    ? 'the provider and its wrapper were killed, so no exit code was written'
    : 'the provider never started: its wrapper reported no pid'
  let last = (await text(f.err).catch(() => undefined))
    ?.split('\n').map((l) => l.trim()).filter(Boolean).at(-1)
  return last ? `${how}: ${last.slice(0, 300)}` : how
}

// A run's checkout, taken back now that the run is over — its row brought up
// to date first, so a resume can create it again where it stood. One that
// holds work (uncommitted, or commits nothing has landed) is kept.
let taken = async (g: Graph, path: string): Promise<void> => {
  try {
    await disk.stat(path)
  } catch {
    return
  }
  // A directory without its checkout is a removal cut off part way, its
  // process killed: Git removes only a clean checkout, so what is left is
  // files nothing tracks, and the removal is finished.
  if (!await locate(path)) return await disk.remove(path, { recursive: true })
  let tree = await discover(g, path)
  if (comp(tree, 'worktree')?.managed && !await retained(g, tree.entity.eid)) {
    let base = comp(tree, 'checkout')?.base
    await reclaim(
      path,
      'refs/heads/main',
      base == null ? undefined : String(base),
    )
  }
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
  let over = async () => comp(await ran(g, session), EXIT) != null
  let pid = Number(
    (comp(await ran(g, session), PROCESS) as Process | undefined)?.pid ?? 0,
  )
  if (!pid || await over()) return
  await signal(session, pid, 'TERM', o)
  for (let end = Date.now() + (o.grace ?? 10_000); Date.now() < end;) {
    if (await over()) return
    await sleep(o.poll ?? 250)
  }
  await signal(session, pid, 'KILL', o)
}

/**
 * Read every run written since `since` again for its model requests
 * (@yaks/session/tail `recount`): the requests and what each one carried,
 * where a reading from before requests were read counted only the run's whole
 * usage on its ending. A run is read from the copy its provider keeps of its
 * thread (@yaks/session/service `kept`), which also holds the parts every
 * request carried ahead of the conversation (its system prompt, its tools),
 * else from its own log, which is tidied away in time. Answers how many
 * requests it wrote.
 *
 * ```ts
 * import { recounted } from '@yaks/spawn'
 *
 * // await recounted(graph, '2026-10-13')
 * ```
 */
export let recounted = async (
  g: Graph,
  since: string,
  o: Opts = {},
): Promise<number> => {
  let after = Date.parse(since)
  let copies = await kept()
  let wrote = 0
  for (let b of await g.read(`.${SESSION}&.${PROCESS}&*`)) {
    if (o.signal?.aborted) break
    let session = b.entity.eid
    let copy = copies.get(String(comp(b, SESSION)?.id ?? session))
    let log = copy ?? await own(g, session, o)
    if (!log || (mtime(log.path) ?? 0) < after) continue
    wrote += await recount(g, log.path, log.read, {
      session,
      signal: o.signal,
    })
  }
  return wrote
}

let mtime = (path: string) => {
  try {
    return disk.statSync(path).mtime?.getTime()
  } catch {
    return undefined
  }
}

// A run's own log and how its provider's lines read, while it is kept.
let own = async (g: Graph, session: string, o: Opts) => {
  let path = paths(session, o).out
  if (mtime(path) == null) return null
  let job = await asked(g, session).catch(() => null)
  let adapter = job && (o.adapters ?? known)[job.provider]
  return adapter ? { path, read: adapter.read } : null
}
