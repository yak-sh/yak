import { trash } from '@yaks/process/trash'
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
import { type Built, line, sub } from '@yaks/query'
import { Stale } from '@yaks/graph/errors'
import { enqueue, sleep } from '@yaks/effects'
import type { Room } from '@yaks/machine/room'
import { derivedEid } from '@yaks/graph/identity'
import { token } from '@yaks/graph/sha256'
import {
  accounted,
  CLAIM,
  cleanEnd,
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
import { home as signedIn, moveThread } from '@yaks/session/files'
import { accountEid, signingIn } from '@yaks/model'
import { freest, type Reading } from '@yaks/model/route'
import { kept } from '@yaks/session/service'
import {
  clean,
  EXIT,
  type Exit,
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
import { type Adapter, adapters as known } from './adapters.ts'
import { continuing } from './brief.ts'
import { complete } from './completion.ts'
import {
  type Account,
  type Asked,
  asked,
  carry,
  going,
  offeredTo,
  proc,
} from './asked.ts'

export {
  type Account,
  type Asked,
  asked,
  carry,
  offeredTo,
  requestOf,
  spelling,
} from './asked.ts'

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
  /** The room reading for a queued start, or an admission decision from
   * a caller supplying its own policy. Defaults to this computer's room. */
  admit?: () => Promise<Room | boolean>
  /** mint an entry's eid (default a uuid) */
  mint?: () => string
  /** where a failure that has nobody to throw at goes: the host's tracker
   * (@yaks/cli `Host.report`), else the console */
  report?: Report
  /** the host shutting down (@yaks/cli `Host.stopping`): a run's log is read
   * until the run is over or this aborts, so a tail never polls a graph that
   * has closed (default never) */
  signal?: AbortSignal
  /** where work a run leaves going past the call that began it is handed (its
   * log's reader, a kill, a spare checkout being cut), so a host that closes
   * waits it out while its graph is open ({@link detached}); default let go */
  detach?: (work: Promise<unknown>) => void
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

let told = (o: Opts): Report =>
  o.report ?? ((err, context) => console.error(err, context ?? ''))

// Work left going past the call that began it: told where it fails, and handed
// to whatever waits it out.
let loose = (o: Opts, work: Promise<unknown>): void => {
  let caught = work.catch(told(o))
  o.detach?.(caught)
}

/**
 * An {@link Opts.detach} whose release, handed to `defer` (@yaks/host
 * `Host.defer`), waits out all the work given to it, including work that
 * work starts as it finishes. A host defers it, so no reader of a run is
 * still reading when the host's graph closes.
 *
 * ```ts
 * import { detached } from '@yaks/spawn'
 *
 * let releases: (() => Promise<void>)[] = []
 * let detach = detached((release) => void releases.push(release))
 * detach(Promise.resolve())
 * await releases[0]()
 * ```
 */
export let detached = (
  defer: (release: () => Promise<void>) => void,
): (work: Promise<unknown>) => void => {
  let going = new Set<Promise<unknown>>()
  defer(async () => {
    while (going.size) await Promise.allSettled(going)
  })
  return (work) => {
    going.add(work)
    let gone = () => void going.delete(work)
    work.then(gone, gone)
  }
}

// A failure that happened to a session's run, told where it is seen (M-37965).
// Its message keys the bug it is filed under, so what varies run to run, such
// as the line a killed run happened to print last, goes in its `cause`.
let failure = (
  o: Opts,
  session: string,
  step: string,
  message: string,
  cause?: string,
) =>
  void Promise.resolve(
    told(o)(new Error(message, cause ? { cause } : undefined), {
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

/**
 * The account a first run signs in with: the one its request names, else the
 * offered account (`account{offered}`) of its CLI's provider further under
 * its weekly pace (@yaks/model `freest`), and none where its CLI keeps no
 * account or its provider offers none.
 *
 * ```ts
 * import { accountFor } from '@yaks/spawn'
 *
 * // let account = await accountFor(graph, adapters.claude, job)
 * ```
 */
export let accountFor = async (
  g: Graph,
  adapter: Adapter,
  job: Asked,
  now: number = Date.now(),
): Promise<Account | undefined> => {
  if (job.account || !adapter.account) return job.account
  let chosen = await offered(g, adapter.account, now)
  return chosen && { eid: chosen.eid, home: chosen.home }
}

// The offered account of a CLI's provider a run is best given, all but
// `other`'s (@yaks/model `freest`), and whether its plan is `full`.
let offered = async (
  g: Graph,
  runner: NonNullable<Adapter['account']>,
  now: number,
  other?: string,
): Promise<(Account & { full?: true }) | undefined> => {
  let rows = (await offeredTo(g, runner)).filter((b) => b.entity.eid != other)
  let homes = new Map(
    rows.map((b) => [b.entity.eid, String(comp(b, 'account')!.home)]),
  )
  let chosen = freest({
    accounts: [...homes].map(([account, home]) => ({
      account,
      name: home.slice(home.lastIndexOf('/') + 1),
    })),
    readings: (await g.read('.rate_limit *')).map((b) =>
      b.rate_limit as Reading
    ),
    now,
  })
  return chosen && {
    eid: chosen.account,
    home: homes.get(chosen.account)!,
    ...chosen.full ? { full: chosen.full } : {},
  }
}

// What a run its plan's limit ended is told as it carries on elsewhere.
const MOVED = "Your account's plan limit ended your last turn, and you now " +
  'run on another account. Carry on where you left off.'

// A run its plan's limit ended carries on in another offered account of its
// CLI with room (`offered`), on its thread, moved to that account
// (@yaks/session `moveThread`), and the session's account moves with it: its
// request names the new one, and so does the request that tells it to carry
// on. Nothing moves for a run that plays a recording, nor where no other
// account has room or its thread is not where its account keeps threads.
// Whether it moved.
let moveOn = async (
  g: Graph,
  session: string,
  o: Opts,
  now = Date.now(),
): Promise<boolean> => {
  let job = await asked(g, session).catch(() => null)
  let adapter = adapterOf(job, o)
  let runner = adapter?.account
  if (!job || job.recorded || !adapter || !runner) return false
  let env = runEnv(adapter, job, o)
  let from = signedIn(runner, { get: (name) => env[name] })
  let to = from && await offered(g, runner, now, accountEid(from))
  if (!from || !to || to.full) return false
  let thread = comp(await one(g, session), SESSION)?.id
  if (
    thread != null &&
    !await moveThread({ runner, dir: from }, to.home, String(thread))
  ) return false
  let [first, last] = await Promise.all([
    firstRequest(g, session),
    latestRequest(g, session),
  ])
  await g.apply([
    { entity: { eid: first!.entity.eid }, using: { account: to.eid } },
    {
      entity: {
        eid: derivedEid(`spawn moving ${session} ${last?.entity.eid ?? ''}`),
      },
      entry: { session },
      using: { ...comp(first, 'using'), account: to.eid },
      content: { body: MOVED },
    },
  ], { trusted: true })
  return true
}

// The environment a run starts in: the server's own, the adapter's
// variables, and the sign-in of the account it runs on.
let runEnv = (
  adapter: Adapter,
  job: Asked,
  o: Opts,
): Record<string, string> => {
  let env = { ...o.env ?? system.env.toObject(), ...adapter.env }
  return adapter.account && job.account
    ? signingIn(adapter.account, job.account.home, env)
    : env
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

// The adapter a request is run and read by: the one its provider speaks.
let adapterOf = (job: Asked | null, o: Opts): Adapter | undefined =>
  job ? (o.adapters ?? known)[job.speaks] : undefined

// A reader whose plan limits are the job's provider's: a stream names its
// CLI's own plan, and the plan a run spends is its provider row's, so a
// provider that speaks another's CLI never moves that one's readings. A
// recording's readings (`provider.recorded`) are of no plan, and none is kept.
let metered = (read: Reader, job: Asked): Reader => (e) => {
  let { limits, ...said } = read(e)
  if (!limits || job.recorded) return said
  let { provider } = job
  return { ...said, limits: limits.map((l) => ({ ...l, provider })) }
}

// How a run's log reads: its usage answers `ask`, and the plan limits it
// reports are its provider's, of the account its CLI signs in with in the
// run's environment.
let reading = (
  adapter: Adapter,
  job: Asked,
  o: Opts,
  ask: Comp = job.ask,
): Reader => {
  let env = runEnv(adapter, job, o)
  let dir = adapter.account &&
    signedIn(adapter.account, { get: (name) => env[name] })
  return accounted(
    metered(answering(adapter.read, ask), job),
    dir ? accountEid(dir) : undefined,
  )
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
    await sleep(wait, o.signal)
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

/** Where a bare run is started: an empty directory of its own beside its
 * log, so no checkout's files or instruction files are near it. It is made
 * for the run and removed with the run's files. */
export let emptyOf = (session: string, o: Opts = {}): string =>
  paths(session, o).out.replace(/\.out$/, '.bare')

// A bare run's directory, made empty.
let emptied = async (session: string, o: Opts): Promise<string> => {
  let dir = emptyOf(session, o)
  await trash(dir)
  await disk.mkdir(dir, { recursive: true })
  return dir
}

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
  let [work] = (await g.read(line`.${CLAIM}.session=${session}`))
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
  admit?: () => Promise<boolean>,
): Promise<Run | null> => {
  let row = await one(g, session)
  if (!row || row.stop || going(row)) return null
  let job = await asked(g, session)
  if (!job) return null
  let adapter = adapterOf(job, o)
  if (!adapter) return null
  if (row[PROCESS] && !await requested(g, session)) return null
  if (admit && !await admit()) return null
  // A run signs in with the account its request records, else is given an
  // offered one. A CLI that runs only on offered accounts (`offeredOnly`)
  // never signs in with the box's default login, the owner's own.
  let recorded = job.account
  let account = await accountFor(g, adapter, job)
  if (account) job = { ...job, account }
  if (adapter.offeredOnly && !job.account) {
    throw new Error(
      `no ${adapter.account} account is offered to runs, so ${session} ` +
        'starts nothing',
    )
  }
  let selection = {
    entity: { eid: String(job.ask.through) },
    using: {
      ...job.ask.to ? { model: String(job.ask.to) } : {},
      ...job.account ? { account: job.account.eid } : {},
    },
  }
  if (row?.[PROCESS]) {
    // A session that ran before carries on its provider's thread, given what
    // it was told since. One whose start was cut off before its provider
    // began a thread begins now, given everything it was told.
    let thread = comp(row, SESSION)?.id
    // A thread begun before its request recorded an account sits in the
    // box's default login; one just given an account carries on there, so
    // the thread moves with it, or its provider finds no conversation.
    if (thread != null && !recorded && job.account) {
      let { account: _, ...bare } = job
      let from = signedIn(
        adapter.account!,
        { get: (name) => runEnv(adapter, bare, o)[name] },
      )
      if (from && from != job.account.home) {
        await moveThread(
          { runner: adapter.account!, dir: from },
          job.account.home,
          String(thread),
        )
      }
    }
    let said = thread == null
      ? await everything(g, session)
      : await unanswered(g, session)
    let carried = carry(row, job, said)
    if (!carried) return null
    let briefs = await continuing(g, session)
    job = {
      ...carried,
      instruction: [...briefs, carried.instruction].join('\n\n'),
    }
  }
  // A bare run has no tools to work in a checkout with, so none is cut for
  // it: it starts in an empty directory of its own.
  let home = job.bare
    ? emptyOf(session, o)
    : o.worktrees
    ? checkoutOf(session, o.worktrees)
    : o.cwd
  if (!await take(g, session, row, home ?? system.cwd())) return null
  let run: Run
  let t: Tail
  try {
    // Keep the resolved choice on the request before launch, including requests
    // written directly by helpers. A later provider default cannot change it.
    await g.apply([selection])
    let cwd = job.bare
      ? await emptied(session, o)
      : o.worktrees
      ? await cut(g, session, o)
      : o.cwd
    let persona = await given(g, session, cwd ?? system.cwd(), adapter)
    let [program, ...args] = adapter.argv({
      ...job,
      persona,
      mcp: o.mcp,
      without: o.without?.[job.provider],
    })
    // Placed before the child writes a line: a log cleaned since the last run
    // is new, and its lines are numbered on from where the transcript stands.
    t = await tail(g, paths(session, o).out, { session })
    run = await (o.launch ?? launch)(store(g), {
      command: job.command ?? program,
      args,
      cwd,
      env: sessionEnv(session, runEnv(adapter, job, o)),
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
  if ((await ran(g, session))?.stop) loose(o, down(g, session, o))
  // The next run's checkout is made from a spare in about a second, where one
  // cut whole takes several: one is cut once this run has launched.
  if (o.worktrees && !job.bare) {
    loose(
      o,
      keepSpare(
        o.cwd ?? system.cwd(),
        checkoutOf(session, o.worktrees),
        'refs/heads/main',
      ),
    )
  }
  let through = String(job.ask.through)
  loose(
    o,
    follow(g, session, reading(adapter, job, o), o, { through, tail: t }),
  )
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

/** Finish a managed turn and tell it about dependencies completed during
 * the run. Called only after its final log bytes have been imported. */
export let finish = async (
  g: Graph,
  session: string,
  o: Opts = {},
  through?: string,
): Promise<boolean | undefined> => {
  let next = await ended(g, session, o, through)
  try {
    // A run carried on in another account, or retried, goes on as one that
    // ended well.
    if (next == 'limit' && await moveOn(g, session, o)) return true
    if (next == 'retry') return await retry(g, session), true
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
    if (o.worktrees) await taken(g, session, checkoutOf(session, o.worktrees))
    await trash(emptyOf(session, o))
    await clean(session, o)
  }
  if (!well || !await requested(g, session)) return
  // The original effect may already have seen the live process and settled.
  // Once the session can launch again, put its request back in the queue.
  if (g.vocab.comp('effect')) {
    let request = await latestRequest(g, session)
    if (request) await enqueue(g, 'spawn_start', request.entity.eid)
  } else await start(g, session, o)
}

// Read a run's log on, from where its transcript stands, against the request
// in force: the newest, which is what the run being read answers.
let readOn = async (g: Graph, session: string, o: Opts): Promise<void> => {
  let job = await asked(g, session).catch(() => null)
  let adapter = adapterOf(job, o)
  let request = await latestRequest(g, session)
  if (job && adapter) {
    let ask = { ...job.ask, through: request?.entity.eid ?? job.ask.through }
    loose(
      o,
      follow(g, session, reading(adapter, job, o, ask), o, {
        through: String(ask.through),
      }),
    )
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
  for (let row of await g.read(line`.${SESSION}&.${PROCESS}&!${EXIT}&*`)) {
    let w = proc(row)?.watcher
    if (!looked.has(w)) looked.set(w, watcherOf(g, row))
    let watcher = await looked.get(w)!
    if (unlaunched(row)) {
      if (watcher == 'over') loose(o, again(g, row, o))
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
  let counts = async (q: Built) =>
    new Map(
      (await g.rows(line`${sub(q)}&.tally=entry.session`))
        .map((r) => [String(r.value), Number(r.n)]),
    )
  let [asks, over] = await Promise.all([
    counts(line`.using&!ask`),
    counts(line`.stop`),
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
  // Only their eids: every ended run's whole row is megabytes read cold at
  // each start-up. More requests than stops only says where to look: a run
  // carried on can end once for both, so one whose newest request has its
  // ending is over, and its report was given then.
  let ended =
    (await g.read(line`.${SESSION}&.${PROCESS}&.${EXIT}&.fields=entity.eid`))
      .map((b) => b.entity.eid)
      .filter((eid) => !read.has(eid))
  for (let eid of ended) {
    let short = (asks.get(eid) ?? 0) > (over.get(eid) ?? 0)
    if (
      logs.has(eid) ||
      short && !await answered(g, eid, await latestRequest(g, eid))
    ) {
      await readOn(g, eid, o)
    }
  }
  return runs
}

// Whether a request has its ending after it: a run asks once and ends once,
// and an ending answers every request before it.
let answered = async (
  g: Graph,
  session: string,
  request: Bundle | undefined,
): Promise<boolean> => {
  let stop = await receiptOf(g, session)
  let seq = (b?: Bundle) => Number(comp(b, 'entry')?.seq ?? 0)
  return !!stop && seq(stop) > seq(request)
}

// A run that ended without saying so. A provider prints a terminal event when
// it finishes a turn; one that was killed, crashed, or simply stopped talking
// prints nothing, and a transcript whose newest line is a `say` reads as
// running forever. So the ending is written down — the process ending is
// observed, not inferred from the conversation, which is the difference
// between evidence and a guess. A run said it ended when the request it
// answered has a stop after it. What ended it, unasked, when it goes on: its
// plan's limit, or a provider it could not reach the first time.
let ended = async (
  g: Graph,
  session: string,
  o: Opts,
  through?: string,
): Promise<Onward | undefined> => {
  let request = through
    ? await one(g, through)
    : await latestRequest(g, session)
  if (await answered(g, session, request)) return undefined
  let seq = (b?: Bundle) => Number(comp(b, 'entry')?.seq ?? 0)
  let row = await ran(g, session)
  let code = comp(row, EXIT)?.code as number | null | undefined
  // A shell or service manager can ask the provider to stop without writing
  // through session_stop. These signals request termination; SIGKILL and
  // crash signals still report a failure.
  let stopped = !!row?.stop || [129, 130, 143].includes(code ?? 0)
  let said = code === 0 ? undefined : await refused(g, session, seq(request))
  let no = declined(said?.code)
  // A provider it could not reach is tried once more: the run the retry
  // started that ends the same way is the failure.
  let again = !stopped && no == DECLINED.server_error &&
    !await retried(g, request)
  let end = code === 0
    ? undefined
    : no
    ? { how: no.why, last: said!.body, own: true }
    : await cause(session, row, o, said?.body)
  let why = end
    ? `${stopped ? 'asked to stop, ' : ''}${end.how}${
      end.last ? `: ${end.last}` : ''
    }`
    : ''
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
        reason: no
          ? no.reason
          : stopped
          ? 'Asked to stop'
          : code == null
          ? 'Provider exit was not observed'
          : `Provider exited ${code}`,
      },
      content: { body: why },
      output: { source: session },
    }),
  }], { trusted: true })
  // A run nobody asked to stop that ended any way but cleanly is a failure,
  // told where it is seen. One its provider declined ended as the provider
  // chose, and its starter hears why (./completion.ts); one that played a
  // recording ended as it was chosen to; one that is retried goes on.
  if (
    code !== 0 && !stopped && !again &&
    (!no || no == DECLINED.server_error) &&
    !(await asked(g, session).catch(() => null))?.recorded
  ) {
    let { how, last, own } = end!
    failure(
      o,
      session,
      'run ended',
      `a spawned run ended: ${own ? why : how}`,
      own ? undefined : last,
    )
  }
  return stopped
    ? undefined
    : no == DECLINED.rate_limit
    ? 'limit'
    : again
    ? 'retry'
    : undefined
}

// How a run that ended goes on: in another account (`moveOn`), or retried.
type Onward = 'limit' | 'retry'

// What a run a provider it could not reach ended is told as it is retried.
const RETRIED = 'The provider could not be reached and ended your last ' +
  'turn. Carry on where you left off.'

// Whether a request is the retry of a run its provider could not reach.
let retried = async (g: Graph, request?: Bundle): Promise<boolean> =>
  !!request && comp(
      await one(g, request.entity.eid, ['content']),
      'content',
    )?.body == RETRIED

// A run a provider it could not reach ended (a network down, a DNS not up
// yet at boot) is asked again on its thread and account, once, by a request
// that tells it to carry on.
let retry = async (g: Graph, session: string): Promise<void> => {
  let last = await latestRequest(g, session)
  await g.apply([{
    entity: {
      eid: derivedEid(`spawn retrying ${session} ${last?.entity.eid ?? ''}`),
    },
    entry: { session },
    using: comp(last, 'using'),
    content: { body: RETRIED },
  }], { trusted: true })
}

// The refusals that are the provider declining a run, not a fault of it: its
// plan's limit, its content filter refusing what the run was asked, and its
// API out of reach (`server_error`: a 5xx, or no network). Each is the reason
// the run's ending records, and what its account begins with.
let DECLINED: Record<string, { reason: string; why: string }> = {
  rate_limit: {
    reason: 'Plan limit reached',
    why: "the provider's plan limit ended the run",
  },
  content_policy: {
    reason: 'Provider refused the content',
    why: "the provider's content filter refused the run",
  },
  server_error: {
    reason: 'Provider unreachable',
    why: 'the provider could not be reached',
  },
}
let declined = (code?: string) =>
  code && Object.hasOwn(DECLINED, code) ? DECLINED[code] : undefined

// What the provider said refused this turn, if it did: a `refusal` after the
// request, one that declined the run (DECLINED) first, else the newest.
let refused = async (
  g: Graph,
  session: string,
  after: number,
): Promise<{ code: string; body: string } | undefined> => {
  let rows = await g.read(
    line`.entry.session=${session}&.refusal&.entry.seq>${after}&.order=-entry.seq&.limit=8&*`,
  )
  let hit = rows.find((r) => declined(String(comp(r, 'refusal')?.code))) ??
    rows[0]
  return hit && {
    code: String(comp(hit, 'refusal')?.code),
    body: String(comp(hit, 'content')?.body || 'the turn failed'),
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

// A SIGKILL in a run whose scope the OOM killer took processes from is the
// session's memory cap (bin/limits), not a kill anyone sent.
let capped = (oom: number) =>
  ` at its session's memory cap: the kernel's OOM killer ended ${oom} ` +
  `process${oom == 1 ? '' : 'es'} in the run`

// How a run ended, as its row and its files show it: the code its wrapper
// wrote, the signal that code names and whether the memory cap sent it, or
// why there is none; then the last line it printed on stderr, which is where a
// provider says what went wrong, unless it said why in its transcript
// (`said`, a refusal's text), which comes first. That line is the run's `own`
// reason when the provider exited by itself; when something killed it, the
// line is only what it happened to be printing.
type End = { how: string; last?: string; own: boolean }

let cause = async (
  session: string,
  row: Bundle | undefined,
  o: Opts,
  said?: string,
): Promise<End> => {
  let exit = comp(row, EXIT) as Exit | undefined
  let code = exit?.code
  let signal = code != null && code > 128 ? SIGNALS[code - 128] : undefined
  let f = paths(session, o)
  let reported = proc(row)?.pid != null ||
    await disk.stat(f.pid).then(() => true, () => false)
  let cap = signal == 'SIGKILL' && exit?.oom ? capped(exit.oom) : ''
  let how = code != null
    ? signal
      ? `the provider was ended by ${signal} (exit ${code})${cap}`
      : `the provider exited ${code}`
    : reported
    ? 'the provider and its wrapper were killed, so no exit code was written'
    : 'the provider never started: its wrapper reported no pid'
  let last = said ?? (await text(f.err).catch(() => undefined))
    ?.split('\n').map((l) => l.trim()).filter(Boolean).at(-1)
  return {
    how,
    ...last ? { last: last.slice(0, 300) } : {},
    own: said != null || (code != null && !signal),
  }
}

// A run's checkout, taken back now that the run is over — its row brought up
// to date first, so a resume can create it again where it stood. One that
// holds work (uncommitted, or commits nothing has landed) is kept, and so is
// one whose session a next run has taken meanwhile (`take` clears its exit):
// that run is starting in it.
let taken = async (g: Graph, session: string, path: string): Promise<void> => {
  let over = async () => (await ran(g, session))?.[EXIT] != null
  if (!await over()) return
  try {
    await disk.stat(path)
  } catch {
    return
  }
  // Lost Git metadata cannot establish that a directory holds no unique work.
  if (!await locate(path)) {
    await trash(path)
    return
  }
  let tree = await discover(g, path)
  if (comp(tree, 'worktree')?.managed && !await retained(g, tree.entity.eid)) {
    let base = comp(tree, 'checkout')?.base
    await reclaim(
      path,
      'refs/heads/main',
      base == null ? undefined : String(base),
      over,
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
  for (let b of await g.read(line`.${SESSION}&.${PROCESS}&*`)) {
    if (o.signal?.aborted) break
    let session = b.entity.eid
    let copy = copies.get(String(comp(b, SESSION)?.id ?? session))
    let log = copy ?? await own(g, session, o)
    if (!log || (await mtime(log.path) ?? 0) < after) continue
    wrote += await recount(g, log.path, log.read, {
      session,
      signal: o.signal,
    })
  }
  return wrote
}

let mtime = async (path: string) => {
  try {
    return (await disk.stat(path)).mtime?.getTime()
  } catch {
    return undefined
  }
}

// A run's own log and how its provider's lines read, while it is kept.
let own = async (g: Graph, session: string, o: Opts) => {
  let path = paths(session, o).out
  if (await mtime(path) == null) return null
  let job = await asked(g, session).catch(() => null)
  let adapter = adapterOf(job, o)
  return adapter ? { path, read: adapter.read } : null
}
