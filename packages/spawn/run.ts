// A managed session: the provider started as a detached command, and its
// stdout read back as the transcript.
//
// Three facts hold it up, and two of them are already somebody else's.
//
// 1. THE CHILD OUTLIVES US. @yaks/process owns that: a launcher that exits at
//    birth, a `setsid` wrapper in its own `systemd-run --user --scope` unit, a
//    pidfile and a code file that are enough to adopt the run back. The
//    `process` row lands on the SESSION's own entity — one entity, one run —
//    which is what @yaks/session means by "where it runs is @yaks/process
//    `process`". Nothing here reaps anything.
// 2. THE FILE IS THE LOG. The child's stdout is @yaks/process's `<eid>.out`,
//    appended by the wrapper and durable across every restart of this process.
//    What the graph holds is the TRANSCRIPT read out of it: one entry per line
//    the adapter recognizes, wearing `imported{source, line}`. That stamp is
//    the cursor too — the highest line already imported is where a resume
//    starts — so importing is exactly-once without a column to keep current.
// 3. THE REQUEST IS AN ENTRY. A session is asked for a provider, a model and
//    an effort by the `using` on its first entry, and the prose beside it is
//    the instruction. There is no launch route and no spawn column: the batch
//    that writes that entry is the request, and ./effects.ts is what answers
//    it.
//
// A stop is a `stop` on the session's own entity, beside its process — the
// same word @yaks/process reads beside a `service` row. A `stop` on an ENTRY
// is the other thing that word means, a mark in the transcript, and the two
// never collide because one rides a session and the other rides a line.

import type { Bundle, Comp, Graph } from '@yaks/graph'
import { SESSION } from '@yaks/session'
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
import { type Adapter, adapters as known, type Job } from './adapters.ts'

/** How a spawn runs, all optional. */
export type Opts = {
  /** the providers that are commands, by name (default the package's table) */
  adapters?: Record<string, Adapter>
  /** where the child runs (default this process's own cwd) */
  cwd?: string
  /** the child's whole environment (default this process's own, since a
   * provider's subscription auth rides `HOME` and its CLI rides `PATH`) */
  env?: Record<string, string>
  /** where @yaks/process keeps its files (default its own rule) */
  dir?: string
  /** how often the log and the ending are read (ms, default 250) */
  poll?: number
  /** how long the wrapper has to report for duty (ms, @yaks/process default) */
  birth?: number
  /** how long a stopped run has after TERM before KILL (ms, default 10_000) */
  grace?: number
  /** mint an entry's eid (default a uuid) */
  mint?: () => string
  /** where a failure that has nobody to throw at goes */
  report?: (err: unknown) => void
}

let uuid = () => crypto.randomUUID() as string
let sleep = (ms: number) => new Promise((go) => setTimeout(go, ms))
let told = (o: Opts) => o.report ?? ((err: unknown) => console.error(err))

let comp = (b: Bundle | undefined, name: string) =>
  b?.[name] as Comp | undefined

let one = async (g: Graph, eid: string): Promise<Bundle | undefined> =>
  (await g.storage.tx((tx) => tx.get([eid])))[0]

/** What a session was asked for, as the graph holds it. */
export type Asked = Job & {
  /** the provider's name, which is what names an adapter */
  provider: string
}

// The efforts a model admits, space- or comma-separated. An empty allowlist
// admits anything: a provider that never takes the word cannot refuse one.
let levels = (efforts: unknown): string[] =>
  String(efforts ?? '').split(/[\s,]+/).filter(Boolean)

/**
 * Read a session's request off its transcript: the `using` on its first entry
 * that carries one, and the prose that came with it.
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
  let entries = await g.read(`.entry.session=${session}&.order=entry.seq`)
  let request = entries.find((b) => b.using)
  if (!request) return null
  let using = comp(request, 'using')!
  if (!using.provider) return null
  let [provider, model] = await g.storage.tx((tx) =>
    tx.get([String(using.provider), String(using.model ?? '')])
  )
  let name = String(comp(provider, 'provider')?.name ?? '')
  if (!name) return null
  let served = comp(model, 'model')
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
    model: served ? String(served.name ?? '') : undefined,
    effort: effort || undefined,
    instruction: String(said?.body ?? ''),
  }
}

// How far the transcript has already read its own log: the highest line
// imported, which is where the next read starts. The stamp IS the cursor, so
// nothing has to be kept current for a resume to be exact.
let consumed = async (g: Graph, session: string): Promise<number> => {
  let [last] = await g.read(
    `.imported&.entry.session=${session}&.order=-imported.line&.limit=1`,
  )
  return Number(comp(last, 'imported')?.line ?? 0)
}

// The byte the line after `lines` starts at. Read once, when a tail begins:
// after that the tail walks forward and the count walks with it.
let after = (path: string, lines: number): number => {
  if (!lines) return 0
  let text: Uint8Array
  try {
    text = Deno.readFileSync(path)
  } catch {
    return 0 // never written: there is nothing to skip
  }
  let seen = 0
  for (let i = 0; i < text.length; i++) {
    if (text[i] != 10) continue
    if (++seen == lines) return i + 1
  }
  return text.length
}

// One stream, read forward from where it stands. The decoder streams, so a
// multi-byte character split across two reads survives the seam.
type Tail = { path: string; at: number; rest: string; dec: TextDecoder }

let sip = (t: Tail): string => {
  let f
  try {
    f = Deno.openSync(t.path)
  } catch {
    return '' // never written: the stream said nothing yet
  }
  try {
    f.seekSync(t.at, Deno.SeekMode.Start)
    let buf = new Uint8Array(64 * 1024)
    let text = ''
    for (let n = f.readSync(buf); n; n = f.readSync(buf)) {
      t.at += n
      text += t.dec.decode(buf.subarray(0, n), { stream: true })
    }
    return text
  } finally {
    f.close()
  }
}

// The complete lines since the last read. `final` flushes a last line the
// process never terminated with a newline.
let lines = (t: Tail, final: boolean): string[] => {
  let parts = (t.rest + sip(t)).split('\n')
  t.rest = final ? '' : parts.pop() ?? ''
  if (final && parts.at(-1) === '') parts.pop()
  return parts
}

/**
 * One line of a provider's log, as the bundles it becomes: the entry it is,
 * and the patch it makes to the session row when it says something about the
 * run itself.
 *
 * A line the adapter does not recognize — and a line that is not JSON at all,
 * which every CLI prints sooner or later — becomes nothing. The file keeps it.
 */
export let imported = (
  session: string,
  source: string,
  line: number,
  text: string,
  adapter: Adapter,
  mint: () => string = uuid,
): Bundle[] => {
  let event
  try {
    event = JSON.parse(text)
  } catch {
    return [] // not JSON: diagnostics, not transcript
  }
  let bundles: Bundle[] = []
  let comps = adapter.entry(event)
  if (comps) {
    bundles.push({
      entity: { eid: mint() },
      entry: { session },
      imported: { source, line },
      // Everything a provider prints is OUTPUT: the run produced it, and the
      // run is the session's own entity. Prose with no `output` beside it is
      // an input, which is the one thing this stream never carries.
      ...(comps.content && !comps.output
        ? { output: { source: session } }
        : {}),
      ...comps,
    })
  }
  let about = adapter.about?.(event)
  if (about) bundles.push({ entity: { eid: session }, ...about })
  return bundles
}

/**
 * Read a run's log into its transcript until the run is over.
 *
 * ```ts
 * import { follow } from '@yaks/spawn'
 *
 * // await follow(graph, session, adapter)
 * ```
 *
 * It resumes where the transcript stands, so the same call serves a fresh
 * launch and a run adopted back after a restart; and it reads the ending
 * BEFORE the last bytes, so nothing written just before an exit is lost.
 */
export let follow = async (
  g: Graph,
  session: string,
  adapter: Adapter,
  o: Opts = {},
): Promise<void> => {
  let path = paths(session, o).out
  let line = await consumed(g, session)
  let tail: Tail = {
    path,
    at: after(path, line),
    rest: '',
    dec: new TextDecoder(),
  }
  let mint = o.mint ?? uuid
  while (true) {
    let over = comp(await one(g, session), EXIT) != null
    let bundles = lines(tail, over)
      .flatMap((text) => imported(session, path, ++line, text, adapter, mint))
    // Trusted: `imported` is server-owned, and this IS the server reading its
    // own file. One apply per pass, so a batch of lines lands as one commit.
    if (bundles.length) await g.apply(bundles, { trusted: true })
    if (over) return ended(g, session, o)
    await sleep(o.poll ?? 250)
  }
}

/**
 * Start a session's provider and read what it says.
 *
 * ```ts
 * import { start } from '@yaks/spawn'
 *
 * // let run = await start(graph, session)
 * ```
 *
 * `null` when this session asked for nothing, or for a provider that is not a
 * command here — an `http` provider is the in-process daemon's, not ours. The
 * tail runs on past this call: what it answers is the process, not the run.
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
    cwd: o.cwd,
    env: o.env ?? Deno.env.toObject(),
  }, {
    ...o,
    eid: session, // one entity: the transcript IS the thing running
    stream: false, // the lines are entries, not anonymous output
  })
  follow(g, session, adapter, o).catch(told(o))
  return run
}

/**
 * Pick every managed session back up. Call it once at start-up, before
 * serving: a run still going is watched again and its log read on from where
 * the transcript stands; one that ended while we were away is stamped now, and
 * the lines it wrote in between are imported in the same pass.
 *
 * ```ts
 * import { resume } from '@yaks/spawn'
 *
 * // let runs = await resume(graph)
 * ```
 */
export let resume = async (g: Graph, o: Opts = {}): Promise<Run[]> => {
  // The narrowed store is the seam @yaks/process already offers: this host
  // answers `running` with the SESSIONS that are running, so the shell's own
  // processes stay the shell's to watch.
  let mine = {
    ...store(g),
    running: () => g.read(`.${SESSION}&.${PROCESS}&.${EXIT}=`),
  }
  let runs = await watch(mine, o)
  for (let run of runs) {
    // The watch's own loop outlives this call and nobody awaits it, so its
    // failure is told rather than thrown at nobody — a process that let the
    // graph go while a tail was still polling is the ordinary way this ends.
    run.done.catch(told(o))
    let job = await asked(g, run.eid).catch(() => null)
    let adapter = job && (o.adapters ?? known)[job.provider]
    if (adapter) follow(g, run.eid, adapter, o).catch(told(o))
  }
  return runs
}

// A run that ended without saying so. A provider prints a terminal event when
// it finishes a turn; one that was killed, crashed, or simply stopped talking
// prints nothing, and a transcript whose newest line is a `say` reads as
// RUNNING forever. So the ending is written down — the process ending is
// observed, not inferred from the conversation, which is the difference
// between evidence and a guess.
let ended = async (g: Graph, session: string, o: Opts): Promise<void> => {
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
