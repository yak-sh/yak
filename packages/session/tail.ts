// The importer: a harness's own log, read into a session's transcript. One
// importer serves every session run outside the graph's own daemon, whatever
// started it: @yaks/spawn follows a managed run's stdout with it, and the
// package's duty (./service.ts) follows the transcript file an interactive
// harness keeps for itself. A reader (./readers.ts) says what each line means;
// this decides which entities it becomes, and writes them.
//
// The log is the durable record, and the graph holds the transcript read out
// of it. The log is a file (@yaks/file's `file{path, root}`, on the volume that
// holds it), and each entry wears the line it came from, `lines{file, start}`.
// The file carries `transcript{session, consumed, version, finished}`: how many
// of its lines have been read, written in the transaction that writes each
// line's entries, and on its own once lines that make none are read past. A
// resume begins there, whatever has become of the entries since: a line that
// made none, or one whose entries a strip deleted, is never read again.
//
// Codex compresses a finished rollout from `X.jsonl` to `X.jsonl.zst`. That is
// another file holding the same lines, so its reading moves with it: the
// transcript, and the session's `session.transcript` where it named the old
// file.
//
// Each entry's eid is derived from its session, its line and its place in the
// line, and a call's from the harness's own id for it, which is what its result
// names. Reading a line twice writes the same entities twice, which changes
// nothing, and a result finds its call without a lookup. A harness can write
// one session's id into two files (two processes under one id), and their
// lines would collide: the session's first file (`session.transcript`) names
// its entries by session and line alone, and an entry of any other file names
// that file's path too.
//
// A call arrives already running, held by the session itself
// (`execution{state, by}`): the harness ran it in its own process, and a tool
// runner (@yaks/tools) leaves a call somebody else holds alone. Its result
// says whether it went through.
//
// This module reads files; it is reached through `@yaks/session/tail`, never
// the main module, which a browser loads.

import { after, batches, records } from './log.ts'

import type { Bundle, Comp, Eid, Graph } from '@yaks/graph'
import { derivedEid, identityEid } from '@yaks/graph/identity'
import { onDisk } from '@yaks/file/local'
import { status } from '@yaks/graph/errors'
import { TOMBSTONE } from '@yaks/graph/bundle'
import { who } from '@yaks/graph/call'
import { toolEid } from '@yaks/tools/result'
import { limitRows, metering } from '@yaks/model'
import type { Comps, Reader, Said } from './readers.ts'
import { humanCaller } from './who.ts'
import type { Chunks } from './archive.ts'
import { fix, step, type Walk, walker } from './parts.ts'

/** A log being read, and the session it is read into. */
export type Tail = {
  /** the file */
  path: string
  /** an immutable source read in bounded asynchronous chunks */
  stream?: Chunks
  version?: string
  skip?: number
  /** the session; a transcript file can name one the graph has not met yet,
   * and it is created with the first line that says something, or once the
   * lines read say nothing */
  session?: Eid
  /** the harness's own id for the session, which a created one carries */
  id?: string
  /** the file, as the bundle that makes it one; its entity keeps how far it
   * has been read */
  file: Bundle
  /** whether this is the file the session was first read from, whose entries
   * are named by session and line alone */
  own: boolean
  /** whether the file's transcript is written yet: its first write says whose
   * transcript it is */
  known: boolean
  /** whether a person drives it; false preserves an automatic opening */
  operator?: boolean
  /** the operator mark already stored on the session */
  operatorStored?: boolean
  /** the lines read so far */
  line: number
  /** the line the file's `consumed` stands at */
  marked: number
  /** the byte the next read starts at */
  at: number
  /** when the newest line that says so was written */
  time?: string
  /** the model the newest line that says so named as answering */
  model?: string
  rest: string
  dec: TextDecoder
  /** what the requests read so far carried (./parts.ts), followed from the
   * log's first line */
  walk?: Walk
  /** a resumed walk, followed in slices before any new entries are read */
  replay?: { line: number; lines: AsyncGenerator<string> }
}

/** How a line is read in. */
export type Pull = {
  /** who a prompt typed into this transcript is signed by */
  person?: Eid
  /** whether the line is of the session's first file; an entry of any other
   * file names its path in its eid too (default true) */
  own?: boolean
  /** keep only the prose: what was typed and what the model said */
  prose?: boolean
  /** flush a last line the harness never ended with a newline */
  final?: boolean
  /** where a line the graph refuses is reported (default the console) */
  report?: (err: unknown) => void
  /** stop between lines once this aborts: what is left stays with the tail,
   * for the next pull, and the session's `consumed` says where the read
   * stood */
  signal?: AbortSignal
  /** stop between lines past this moment (`performance.now()`), the way an
   * abort stops it, once a line is read: a long log is read over several
   * pulls */
  until?: number
}

/** Whether a tail is behind its file: a pull stopped before its end, and
 * holds lines it has not read into the graph yet. */
export let behind = (t: Tail): boolean => t.rest.includes('\n')

let comp = (b: Bundle | undefined, name: string) =>
  b?.[name] as Comp | undefined

/** The entity a harness's call becomes, named by the harness's own id for it,
 * which is also what its result names. */
export let callOf = (session: Eid, id: string): Eid =>
  derivedEid(`call ${session} ${id}`)

/** The entry a model request becomes, named by the harness's own id for it,
 * which every line of its reply names again. */
export let askOf = (session: Eid, id: string): Eid =>
  derivedEid(`ask ${session} ${id}`)

/**
 * Whether an entry is prose: what a person typed (content alone), or what the
 * model said (content and the output that marks it).
 *
 * ```ts
 * import { prose } from '@yaks/session/tail'
 * import { assertEquals } from '@std/assert'
 *
 * assertEquals(prose({ content: { body: 'hi' } }), true)
 * assertEquals(prose({ content: { body: 'hmm' }, reasoning: {}, output: {} }), false)
 * ```
 */
export let prose = (c: Comps): boolean =>
  !!c.content && Object.keys(c).every((k) =>
    k == 'content' || k == 'output' ||
    (!!c.checkpoint && (k == 'checkpoint' || k == 'notice'))
  )

// Selections retain the runner/model provenance of old imported sessions.
let retained = (c: Comps) => prose(c) || !!c.using

// What a person typed: prose with no output beside it.
let typed = (c: Comps) => prose(c) && !c.output && !c.checkpoint

// Two patches to one entity, as one.
let merge = (a: Bundle, b: Bundle): Bundle => {
  let out: Bundle = { ...a }
  for (let [k, v] of Object.entries(b)) {
    out[k] = v && typeof v == 'object' && !Array.isArray(v) && out[k]
      ? { ...out[k] as Comp, ...v as Comp }
      : v
  }
  return out
}

/**
 * One line, as the bundles it becomes: an entry for each thing it says, each
 * sitting at the line of the file it was read from, a row for each tool it
 * names, the answered call's state, and what it says about the session. A
 * prompt a person typed is signed by `person`.
 */
export let imported = (
  said: Said,
  o: {
    session: Eid
    /** the file the line is read from */
    file: Eid
    /** the path it was opened at, which names the entries of a file other
     * than the session's first */
    path: string
    line: number
    person?: Eid
    prose?: boolean
    own?: boolean
  },
): Bundle[] => {
  let { session, file, path, line } = o
  let key = o.own === false ? `${session} ${path}` : session
  let out = new Map<Eid, Bundle>()
  let put = (b: Bundle) => {
    let was = out.get(b.entity.eid)
    out.set(b.entity.eid, was ? merge(was, b) : b)
  }
  // A request comes before what it returned, wherever its reader put it, so
  // the reply ending a turn is its newest entry. Each entry keeps the name
  // its place in the line gives it.
  let asked = (c: Comps) => c.ask?.id != null
  let order = said.entries.map((c, i) => [c, i] as const)
  order = [
    ...order.filter(([c]) => asked(c)),
    ...order.filter(([c]) => !asked(c)),
  ]
  order.forEach(([c, i]) => {
    if (o.prose && !retained(c)) return
    let { call, result, execution, output, using, ask, ...rest } = c
    let row = (name: string, value: unknown) => {
      let eid = identityEid(name, [String(value)])
      put({ entity: { eid }, [name]: { name: String(value) } })
      return eid
    }
    if (using) {
      let refs: Comp = { ...using }
      for (let name of ['provider', 'model']) {
        if (using[name]) refs[name] = row(name, using[name])
      }
      rest.using = refs
    }
    let at = { entry: { session }, lines: { file, start: line } }
    if (ask && ask.id == null) rest.ask = ask
    else if (ask) {
      let { id, to, ...asked } = ask
      put({
        entity: { eid: askOf(session, String(id ?? `${line} ${i}`)) },
        ...at,
        ask: { ...asked, ...(to ? { to: row('model', to) } : {}) },
        ...rest,
      })
      return
    }
    if (call) {
      let { to, ...asked } = call
      let name = String(to ?? '')
      if (name) put({ entity: { eid: toolEid(name) }, tool: { name } })
      put({
        entity: { eid: callOf(session, String(call.id)) },
        ...at,
        call: { ...asked, ...(name ? { to: toolEid(name) } : {}) },
        execution: { by: session },
        ...rest,
      })
      return
    }
    let answers = result && callOf(session, String(result.call))
    put({
      entity: { eid: derivedEid(`${key} ${line} ${i}`) },
      ...at,
      ...(answers ? { result: { ...result, call: answers } } : {}),
      ...(output ? { output: { ...output, source: session } } : {}),
      ...rest,
      ...(typed(c) && o.person
        ? { $actor: { by: o.person, via: session } }
        : {}),
    })
    if (answers && execution) put({ entity: { eid: answers }, execution })
  })
  if (said.about) put({ entity: { eid: session }, ...said.about })
  for (let b of limitRows(said.limits ?? [], said.at)) put(b)
  return [...out.values()]
}

// One line's rows, and when the harness wrote it.
type Line = { bundles: Bundle[]; at?: string }

// What a line says, its plan-limit readings timed and placed: a line that
// reports limits and says no time of its own (Claude's `rate_limit_event`)
// was written after the newest line that said one, and a limit on one model
// is on the model the log last said answers it. `last` keeps both.
let timed = (said: Said, last: { time?: string; model?: string }): Said => {
  last.time = said.at ?? last.time
  last.model = said.model ?? last.model
  if (!said.limits) return said
  let model = last.model && identityEid('model', [last.model])
  return {
    ...said,
    ...!said.at && last.time ? { at: last.time } : {},
    limits: metering(said.limits, model),
  }
}

// How many lines one transaction writes at most, and how much text: a line
// to a transaction rewrites the same index pages once per line, which is
// most of what reading a long log in costs.
let RUN = 500
let RUN_TEXT = 4 * 1024 * 1024

// Each line of a run, without the rows it only touches where the graph or a
// line before it in the run has settled them: a tool's row is written where it
// is missing, since writing it again moves its stamp for nothing, and so is a
// request, which every line of its reply names again; an answer's state only
// where its call is there, or the patch alone would make an entity; a
// plan-limit reading only over an older one. A line `worth` refuses is left
// out of what the lines after it see. Answers the eids the graph held too.
let settled = async (
  g: Graph,
  run: Line[],
  worth: (bundles: Bundle[], i: number) => boolean = () => true,
): Promise<{ lines: Bundle[][]; held: Set<Eid> }> => {
  let eids = new Set(run.flatMap((l) => l.bundles.map((b) => b.entity.eid)))
  let read = new Map<Eid, string>()
  let held = new Set<Eid>()
  for (let r of eids.size ? await g.get([...eids]) : []) {
    if (!r || r[TOMBSTONE] != null) continue
    held.add(r.entity.eid)
    read.set(r.entity.eid, String(comp(r, 'rate_limit')?.at ?? ''))
  }
  let there = new Set(held)
  let lines = run.map(({ bundles }, i) => {
    let kept = bundles.filter((b) => {
      let eid = b.entity.eid
      if (b.rate_limit) {
        return String(comp(b, 'rate_limit')?.at ?? '') >= (read.get(eid) ?? '')
      }
      if (b.entry ? b.ask : b.tool || b.provider || b.model) {
        return !there.has(eid)
      }
      return b.entry || !b.execution || there.has(eid)
    })
    if (!worth(kept, i)) return []
    for (let b of kept) {
      there.add(b.entity.eid)
      if (b.rate_limit) {
        read.set(b.entity.eid, String(comp(b, 'rate_limit')?.at ?? ''))
      }
    }
    return kept
  })
  return { lines, held }
}

// A run's lines as one batch, each entity dated as a transaction per line
// would date it (@yaks/graph `$at`): one the graph held, when the last line
// that writes it was written; a new one, when the first was.
let joined = (run: Line[], held: Set<Eid>): Bundle[] => {
  let at = new Map<Eid, string>()
  for (let { bundles, at: when } of run) {
    if (!when) continue
    for (let { entity: { eid } } of bundles) {
      if (held.has(eid) || !at.has(eid)) at.set(eid, when)
    }
  }
  return fold([], run.flatMap((l) => l.bundles)).map((b) =>
    at.has(b.entity.eid) ? { ...b, $at: at.get(b.entity.eid) } : b
  )
}

let live = (b: Bundle | undefined) => b && b[TOMBSTONE] == null ? b : undefined

/** How far the file at `path` has been read, and into which session: its
 * `transcript`, if it has one. */
export let transcriptOf = async (
  g: Graph,
  path: string,
): Promise<Comp | undefined> => {
  let [file] = await onDisk(g, path)
  let [row] = await g.get([file.entity.eid], ['transcript'])
  return comp(live(row), 'transcript')
}

// Whether a file is its session's first: the one the session names, or any
// file of a session that names none yet.
let owns = async (g: Graph, session: Eid | undefined, file: Eid) => {
  if (!session) return true
  // Ownership needs one stored reference, not the derived transcript status.
  let [s] = await g.read(
    `.entity.eid=${JSON.stringify(session)} .fields=session.transcript`,
  )
  let first = comp(s, 'session')?.transcript
  return !first || first == file
}

// Codex compresses a finished rollout from `X.jsonl` to `X.jsonl.zst`: another
// file, holding the same lines. A compressed file not read yet takes over the
// reading of the one it was compressed from, and the session's first file
// moves with it.
let compressed = async (
  g: Graph,
  file: Bundle,
  path: string,
): Promise<Comp | undefined> => {
  if (!path.endsWith('.zst')) return undefined
  let [was] = await onDisk(g, path.slice(0, -'.zst'.length))
  let from = was.entity.eid
  let [row] = await g.get([from], ['transcript'])
  let held = comp(live(row), 'transcript')
  if (!held) return undefined
  let session = held.session as Eid | undefined
  let [s] = session
    ? await g.read(
      `.entity.eid=${JSON.stringify(session)} .fields=session.transcript`,
    )
    : []
  // Compressing a log is no edit to its session, so `updated` stays. The session
  // moves first: stopped between the two, the next read moves the file.
  if (comp(s, 'session')?.transcript == from) {
    await g.apply([{
      entity: { eid: session! },
      session: { transcript: file.entity.eid },
    }], { trusted: true, stamp: false })
  }
  await g.apply([
    { ...file, transcript: held },
    { entity: { eid: from }, transcript: null },
  ], { trusted: true })
  return held
}

/**
 * A tail on `path`, placed after the lines its transcript says were read.
 *
 * ```ts
 * import { tail } from '@yaks/session/tail'
 *
 * // let t = await tail(graph, '/logs/run.out', { session })
 * ```
 */
export let tail = async (
  g: Graph,
  path: string,
  o: {
    session?: Eid
    id?: string
    stream?: Chunks
    prefix?: string
    version?: string
  } = {},
): Promise<Tail> => {
  let [file] = await onDisk(g, path)
  let [row] = await g.get([file.entity.eid], ['transcript'])
  let held = comp(live(row), 'transcript') ??
    await compressed(g, file, path)
  let previous = held?.version ?? held?.finished
  let changed = o.version && previous && previous != o.version
  let line = changed ? 0 : Number(held?.consumed ?? 0)
  if (changed) {
    await g.apply([{
      entity: { eid: file.entity.eid },
      transcript: { consumed: 0, finished: null, version: o.version },
    }], { trusted: true })
  }
  let fields = [
    'session.operator',
    'session.source',
    'spawned.parent',
    'created.by',
    'created.via',
  ]
    .filter((name) => {
      let [c, p] = name.split('.')
      return g.vocab.props(c).includes(p)
    })
  let [session] = o.session
    ? await g.read(
      `.entity.eid=${JSON.stringify(o.session)} .fields=${fields.join(',')}`,
    )
    : []
  let operatorStored = comp(session, 'session')?.operator as
    | boolean
    | undefined
  let automatic = session && (
    comp(session, 'session')?.source || comp(session, 'spawned')?.parent ||
    !await humanCaller(g, who(session), session.entity.eid)
  )
  return {
    path,
    ...o,
    operator: automatic ? false : operatorStored,
    operatorStored,
    file,
    own: await owns(g, o.session, file.entity.eid),
    known: !!held,
    line,
    marked: line,
    at: o.stream ? 0 : await after(path, line),
    ...(o.stream ? { skip: line } : {}),
    rest: o.prefix ?? '',
    dec: new TextDecoder(),
  }
}

let parsed = (text: string): Record<string, unknown> | undefined => {
  try {
    let e = JSON.parse(text)
    return e && typeof e == 'object' ? e : undefined
  } catch {
    return undefined // not JSON: diagnostics, not transcript
  }
}

// What reading to `line` writes beside the line's own entities: how far the
// file is read, and, the first time, the file itself and whose transcript it
// holds; the session learns its first file, and that a person typed into it.
let marks = (t: Tail, line: number, typed = false): Bundle[] => {
  let operator = typed && t.operator == null ? true : t.operator
  return [
    {
      ...(t.known ? { entity: t.file.entity } : t.file),
      transcript: {
        consumed: line,
        ...(t.version ? { version: t.version } : {}),
        ...(t.known ? {} : { session: t.session }),
      },
    },
    ...(t.own && !t.known || operator != t.operatorStored
      ? [{
        entity: { eid: t.session! },
        session: {
          ...(t.own && !t.known ? { transcript: t.file.entity.eid } : {}),
          ...(operator != t.operatorStored ? { operator } : {}),
        },
      }]
      : []),
  ]
}

// Bundles for entities a list already names folded into those.
let fold = (list: Bundle[], more: Bundle[]): Bundle[] => {
  let out = new Map(list.map((b) => [b.entity.eid, b]))
  for (let b of more) {
    let was = out.get(b.entity.eid)
    out.set(b.entity.eid, was ? merge(was, b) : b)
  }
  return [...out.values()]
}

// A file's first write learns again whether it is its session's first:
// another file of the session may have been written first since the tail was
// opened.
let settle = async (g: Graph, t: Tail) => {
  if (!t.known) t.own = await owns(g, t.session, t.file.entity.eid)
}

// The session a file names, created now that it has said something, as the
// entity the harness's id for it names (./who.ts `sessionEid`).
let created = async (g: Graph, t: Tail): Promise<Eid> => {
  let made = await g.apply([{
    entity: { eid: '$session' },
    session: { id: t.id },
  }])
  return made.find((b) => b.session)!.entity.eid
}

// What a line's entries owe the requests they carry (./parts.ts).
let walked = (w: Walk, made: Bundle[]): Bundle[] =>
  made.filter((b) => b.entry || b.tool).flatMap((b) => step(w, b))

// The walk a tail keeps, begun before it reads a line: a log read from its
// start begins one empty, and one taken up partway first follows the lines
// already read, writing nothing, so its next request knows what came before.
let follow = async (t: Tail, read: Reader, o: Pull): Promise<boolean> => {
  if (!t.walk) {
    t.walk = walker()
    if (t.line && !t.stream && t.session) {
      t.replay = { line: 0, lines: records(t.path) }
    }
  }
  let replay = t.replay
  if (!replay) return true
  let breath = performance.now(), from = replay.line
  while (replay.line < t.line) {
    if (
      o.signal?.aborted ||
      replay.line > from && performance.now() > (o.until ?? Infinity)
    ) return false
    if (performance.now() - breath > 50) {
      await new Promise((go) => setTimeout(go, 0))
      breath = performance.now()
    }
    let raw = await replay.lines.next()
    if (raw.done) break
    let line = ++replay.line
    let event = parsed(raw.value)
    if (!event) continue
    let said = read(event)
    for (let f of said.fixed ?? []) fix(t.walk, f)
    walked(
      t.walk,
      imported(said, {
        ...o,
        session: t.session!,
        file: t.file.entity.eid,
        path: t.path,
        line,
        own: t.own,
      }),
    )
  }
  await replay.lines.return(undefined)
  t.replay = undefined
  return true
}

/**
 * Read what the log holds past the tail into its session, a run of lines to a
 * transaction, each entity dated when the harness wrote the line that wrote it
 * where the line says. A line the reader does not recognize, or one that is not
 * JSON at all, becomes nothing: the file keeps it. Answers how many lines were
 * read.
 *
 * ```ts
 * import { claude } from '@yaks/session'
 * import { pull, tail } from '@yaks/session/tail'
 *
 * // let t = await tail(graph, path, { id })
 * // await pull(graph, t, claude, { person })
 * ```
 */
export let pull = async (
  g: Graph,
  t: Tail,
  read: Reader,
  o: Pull = {},
): Promise<number> => {
  let from = t.line
  let breath = performance.now()
  let run: (Line & { line: number; person: boolean })[] = []
  let text = 0
  // What a run of lines writes, in one transaction. Trusted: `transcript` is
  // server-owned, and this is the server reading a file on its own machine. A
  // run the graph refuses is written again a line at a time, so only the line
  // it refuses is left out: reported, and left in the file, since it would be
  // refused again. Any other failure ends the read, past lines this tail has
  // already taken, so the caller opens a new tail where the transcript stands.
  let write = async (lines: typeof run) => {
    let { lines: kept, held } = await settled(g, lines)
    let last = lines.at(-1)!
    let person = lines.some((l) => l.person)
    await g.apply(
      fold(
        joined(lines.map((l, i) => ({ ...l, bundles: kept[i] })), held),
        marks(t, last.line, person),
      ),
      { trusted: true },
    )
    t.marked = last.line
    t.known = true
    if (person && t.operator == null) t.operator = true
    t.operatorStored = t.operator
  }
  // A run written, or, when the graph refuses it, each of its lines alone.
  let land = async (lines: typeof run): Promise<void> => {
    try {
      await write(lines)
    } catch (e) {
      if (status(e) >= 500) throw e
      if (lines.length == 1) return void (o.report ?? console.error)(e)
      for (let l of lines) await land([l])
    }
  }
  let flush = async () => {
    let lines = run
    run = []
    text = 0
    if (lines.length) await land(lines)
  }
  reading: for await (let all of batches(t, o.final)) {
    if (!o.prose && !await follow(t, read, o)) {
      t.rest = [...all, t.rest].join('\n')
      break
    }
    for (let [i, raw] of all.entries()) {
      if (
        o.signal?.aborted ||
        t.line > from && performance.now() > (o.until ?? Infinity)
      ) {
        t.rest = [...all.slice(i), t.rest].join('\n')
        break reading
      }
      // A long read hands the event loop back every so often: the lease its duty
      // holds and every other duty in the process renew and fire on timers.
      if (performance.now() - breath > 50) {
        await new Promise((go) => setTimeout(go, 0))
        breath = performance.now()
      }
      let line = ++t.line
      let event = parsed(raw)
      if (!event) continue
      let said = timed(read(event), t)
      if (t.walk) { for (let f of said.fixed ?? []) fix(t.walk, f) }
      let kept = o.prose ? said.entries.filter(retained) : said.entries
      if (!kept.length && !said.about && !said.limits?.length) continue
      t.session ??= await created(g, t)
      // A run is one write, so one reading of `own` holds for all its lines.
      if (!run.length) await settle(g, t)
      let made = imported(said, {
        ...o,
        session: t.session,
        file: t.file.entity.eid,
        path: t.path,
        line,
        own: t.own,
      })
      let signed = made.some((b) => b.$actor)
      // A line a person signed is a transaction of its own: in a batch, an
      // entity nobody signs is written by the first writer the batch names
      // (@yaks/graph `writers`), and nothing else in the run is theirs.
      if (signed) await flush()
      run.push({
        bundles: fold(made, t.walk ? walked(t.walk, made) : []),
        at: said.at,
        line,
        person: kept.some(typed),
      })
      text += raw.length
      if (signed || run.length >= RUN || text >= RUN_TEXT) await flush()
    }
  }
  await flush()
  // Lines past the last that made an entry, or refused ones, are marked read
  // where the file is done or not yet known; a file still being written has
  // its next entry carry the mark, or `rest` write it once the file is quiet.
  if (o.final || o.prose || t.stream?.done || !t.known) await rest(g, t)
  if (t.stream?.done && !behind(t) && !t.skip && t.version) {
    await g.apply([{
      entity: t.file.entity,
      transcript: { finished: t.version },
    }], { trusted: true })
  }
  return t.line - from
}

/**
 * Mark a tail's file read to the line the tail stands at, so a resume starts
 * after it and a quiet file reads as imported to its end: what lines that made
 * no entry leave unwritten while the file is still being written (`pull`).
 *
 * ```ts
 * import { rest } from '@yaks/session/tail'
 *
 * // await rest(graph, t) // once its file has gone quiet
 * ```
 */
export let rest = async (g: Graph, t: Tail): Promise<void> => {
  if (t.line <= t.marked) return
  t.session ??= await created(g, t)
  await settle(g, t)
  await g.apply(marks(t, t.line), { trusted: true })
  t.known = true
  t.marked = t.line
}

// What an earlier reading of a line put on an entry that a request now
// carries on its own entry: a run's whole usage on its ending, Codex's usage
// on an entry of its own. The usage comes off, with the cost, request and
// context beside it, and an entry left with nothing of its own goes. `rows`
// holds what the graph holds at the line's entries (`placesOf`).
let unspent = (
  rows: Map<Eid, Bundle>,
  key: string,
  line: number,
  said: Said,
  made: Bundle[],
): Bundle[] => {
  let now = new Map(made.map((b) => [b.entity.eid, b]))
  let plumbing = [
    'entry',
    'lines',
    'usage',
    'cost',
    'ask',
    'context_parts',
    'created',
    'updated',
  ]
  return placesOf(key, line, said).flatMap((eid): Bundle[] => {
    let r = rows.get(eid)
    if (!r || r[TOMBSTONE] != null || !r.usage) return []
    if (now.get(eid)?.usage) return []
    let own = Object.keys(r).some((k) =>
      k != 'entity' && !k.startsWith('$') && !plumbing.includes(k)
    )
    return [
      own
        ? {
          entity: { eid },
          usage: null,
          cost: null,
          ask: null,
          context_parts: null,
        }
        : { entity: { eid }, $delete: true },
    ]
  })
}

// The entries a line's place in the file names.
let placesOf = (key: string, line: number, said: Said): Eid[] =>
  said.entries.map((_, i) => derivedEid(`${key} ${line} ${i}`))

/**
 * Read a log already imported again from its start, for its model requests
 * alone: each request's entry (`ask`, `usage`, `context_parts`) where the
 * session lacks it, the session's `fixed`, and plan limits, each dated when
 * the line was written. What an earlier reading counted elsewhere (on the
 * line's other entries, or as the whole run's usage on its ending) comes off,
 * so each request is counted once. The log can be a copy of the session's
 * own, such as the transcript a provider keeps of a managed run. The
 * transcript's other entries are followed, never written. A run of lines is
 * read and written at once. Answers how many requests it wrote.
 *
 * ```ts
 * import { claude } from '@yaks/session'
 * import { recount } from '@yaks/session/tail'
 *
 * // await recount(graph, path, claude, { session })
 * ```
 */
export let recount = async (
  g: Graph,
  path: string,
  read: Reader,
  o: { session: Eid; signal?: AbortSignal },
): Promise<number> => {
  let [file] = await onDisk(g, path)
  let own = await owns(g, o.session, file.entity.eid)
  let key = own ? o.session : `${o.session} ${path}`
  let w = walker()
  let line = 0, wrote = 0, placed = false
  let last: { time?: string; model?: string } = {}
  let run: (Line & { line: number; said: Said; made: Bundle[] })[] = []
  let size = 0
  let flush = async () => {
    let lines = run
    run = []
    size = 0
    if (!lines.length) return
    let places = lines.flatMap((l) => placesOf(key, l.line, l.said))
    let rows = new Map<Eid, Bundle>()
    for (let r of places.length ? await g.get(places) : []) {
      if (r) rows.set(r.entity.eid, r)
    }
    let gone = lines.map((l) => unspent(rows, key, l.line, l.said, l.made))
    let { lines: kept, held } = await settled(
      g,
      lines,
      // A line with nothing of its own to write is not written.
      (bundles, i) =>
        !!gone[i].length ||
        bundles.some((b) => b.entry || b.rate_limit || b.fixed),
    )
    let all = joined(
      lines.map((l, i) => ({ ...l, bundles: [...kept[i], ...gone[i]] })),
      new Set([...held, ...rows.keys()]),
    )
    if (!all.length) return
    // The entries it writes sit at lines of the file: the first write makes
    // the file an entity too.
    await g.apply([...placed ? [] : [file], ...all], { trusted: true })
    placed = true
    wrote += kept.flat().filter((b) => b.entry).length
  }
  let breath = performance.now()
  for await (let raw of records(path)) {
    if (o.signal?.aborted) break
    if (performance.now() - breath > 50) {
      await new Promise((go) => setTimeout(go, 0))
      breath = performance.now()
    }
    line++
    let event = parsed(raw)
    if (!event) continue
    let said = timed(read(event), last)
    for (let f of said.fixed ?? []) fix(w, f)
    let made = imported(said, {
      session: o.session,
      file: file.entity.eid,
      path,
      line,
      own,
    })
    let owed = walked(w, made)
    let asked = made.filter((b) =>
      b.entry ? b.ask && b.usage : b.provider || b.model || b.rate_limit
    )
    run.push({ bundles: fold(asked, owed), at: said.at, line, said, made })
    size += raw.length
    if (run.length >= RUN || size >= RUN_TEXT) await flush()
  }
  await flush()
  let over = await ended(g, o.session)
  if (over.length) await g.apply(over, { trusted: true })
  return wrote
}

// A run's ending that an earlier reading gave the whole run's usage, where
// the session's requests now carry their own: the usage comes off it, with
// the cost, request and context beside it, as `unspent` takes it off a line
// read again. A provider that reports usage only per run keeps it there.
let ended = async (g: Graph, session: Eid): Promise<Bundle[]> => {
  let [counted] = await g.read(
    `.entry.session=${session} .ask .usage !stop .limit=1`,
  )
  if (!counted) return []
  return (await g.read(`.entry.session=${session} .stop .usage`)).map((b) => ({
    entity: { eid: b.entity.eid },
    usage: null,
    cost: null,
    ask: null,
    context_parts: null,
  }))
}
