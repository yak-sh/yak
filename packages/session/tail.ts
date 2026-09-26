// The importer: a harness's own log, read into a session's transcript. One
// importer serves every session run outside the graph's own daemon, whatever
// started it: @yaks/spawn follows a managed run's stdout with it, and the
// package's duty (./service.ts) follows the transcript file an interactive
// harness keeps for itself. A reader (./readers.ts) says what each line means;
// this decides which entities it becomes, and writes them.
//
// The log is the durable record, and the graph holds the transcript read out
// of it. Each entry carries `imported{source, line}`: the file and the line it
// came from. The session carries how many lines of its log have been read
// (`session.consumed`), written in the transaction that writes each line's
// entries, and on its own once lines that make none are read past. A resume
// begins there, whatever has become of the entries since: a line that made
// none, or one whose entries a strip deleted, is never read again.
//
// Each entry's eid is derived from its session, its line and its place in the
// line, and a call's from the harness's own id for it, which is what its result
// names. Reading a line twice writes the same entities twice, which changes
// nothing, and a result finds its call without a lookup.
//
// A call arrives already running, held by the session itself
// (`execution{state, by}`): the harness ran it in its own process, and a tool
// runner (@yaks/tools) leaves a call somebody else holds alone. Its result
// says whether it went through.
//
// This module reads files; it is reached through `@yaks/session/tail`, never
// the main module, which a browser loads.

import {
  type Bundle,
  type Comp,
  derivedEid,
  type Eid,
  type Graph,
  status,
  TOMBSTONE,
} from '@yaks/graph'
import { toolEid } from '@yaks/tools'
import type { Comps, Reader, Said } from './readers.ts'

/** A log being read, and the session it is read into. */
export type Tail = {
  /** the file */
  path: string
  /** the session; a transcript file can name one the graph has not met yet,
   * and it is created with the first line that says something, or once the
   * lines read say nothing */
  session?: Eid
  /** the harness's own id for the session, which a created one carries */
  id?: string
  /** whether a person has typed into it */
  operator?: boolean
  /** the lines read so far */
  line: number
  /** the byte the next read starts at */
  at: number
  rest: string
  dec: TextDecoder
}

/** How a line is read in. */
export type Pull = {
  /** who a prompt typed into this transcript is signed by */
  person?: Eid
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
}

let comp = (b: Bundle | undefined, name: string) =>
  b?.[name] as Comp | undefined

/** The entity a harness's call becomes, named by the harness's own id for it,
 * which is also what its result names. */
export let callOf = (session: Eid, id: string): Eid =>
  derivedEid(`call ${session} ${id}`)

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
  !!c.content && Object.keys(c).every((k) => k == 'content' || k == 'output')

// What a person typed: prose with no output beside it.
let typed = (c: Comps) => prose(c) && !c.output

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
 * One line, as the bundles it becomes: an entry for each thing it says, a row
 * for each tool it names, the answered call's state, and what it says about
 * the session. A prompt a person typed is signed by `person`.
 */
export let imported = (
  said: Said,
  o: {
    session: Eid
    source: string
    line: number
    person?: Eid
    prose?: boolean
  },
): Bundle[] => {
  let { session, source, line } = o
  let out = new Map<Eid, Bundle>()
  let put = (b: Bundle) => {
    let was = out.get(b.entity.eid)
    out.set(b.entity.eid, was ? merge(was, b) : b)
  }
  said.entries.forEach((c, i) => {
    if (o.prose && !prose(c)) return
    let { call, result, execution, output, ...rest } = c
    let at = { entry: { session }, imported: { source, line } }
    if (call) {
      let { to, ...asked } = call
      let name = String(to ?? '')
      if (name) put({ entity: { eid: toolEid(name) }, tool: { name } })
      put({
        entity: { eid: callOf(session, String(call.id)) },
        ...at,
        call: { ...asked, ...(name ? { to: toolEid(name) } : {}) },
        execution: { state: 'running', by: session },
        ...rest,
      })
      return
    }
    let answers = result && callOf(session, String(result.call))
    put({
      entity: { eid: derivedEid(`${session} ${line} ${i}`) },
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
  return [...out.values()]
}

// The rows a line only touches. A tool's row is written where it is missing,
// since writing it again moves its stamp for nothing; an answer's state only
// where its call is there, or the patch alone would make an entity.
let settled = async (g: Graph, bundles: Bundle[]): Promise<Bundle[]> => {
  let touched = bundles.filter((b) => !b.entry && (b.tool || b.execution))
  if (!touched.length) return bundles
  let rows = await g.storage.tx((tx) =>
    tx.get(touched.map((b) => b.entity.eid))
  )
  let there = new Set(
    rows.filter((r) => r && r[TOMBSTONE] == null).map((r) => r!.entity.eid),
  )
  return bundles.filter((b) =>
    !touched.includes(b) || (b.tool ? !there.has(b.entity.eid) : there.has(
      b.entity.eid,
    ))
  )
}

/** How far a session has read its log: the lines its `consumed` says. */
export let consumed = async (g: Graph, session: Eid): Promise<number> => {
  let [s] = await g.get([session])
  return Number(comp(s, 'session')?.consumed ?? 0)
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

/**
 * A tail on `path`, placed after the lines its session already holds.
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
  o: { session?: Eid; id?: string; operator?: boolean } = {},
): Promise<Tail> => {
  let line = o.session ? await consumed(g, o.session) : 0
  return {
    path,
    ...o,
    line,
    at: after(path, line),
    rest: '',
    dec: new TextDecoder(),
  }
}

// What the file holds past the tail. The decoder streams, so a multi-byte
// character split across two reads is reassembled correctly.
let sip = (t: Tail): string => {
  let f
  try {
    f = Deno.openSync(t.path)
  } catch {
    return '' // never written: the log has said nothing yet
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

// The complete lines since the last read.
let lines = (t: Tail, final = false): string[] => {
  let parts = (t.rest + sip(t)).split('\n')
  t.rest = final ? '' : parts.pop() ?? ''
  if (final && parts.at(-1) === '') parts.pop()
  return parts
}

let parsed = (text: string): Record<string, unknown> | undefined => {
  try {
    let e = JSON.parse(text)
    return e && typeof e == 'object' ? e : undefined
  } catch {
    return undefined // not JSON: diagnostics, not transcript
  }
}

// The session a file names, created now that it has said something.
let created = async (g: Graph, t: Tail): Promise<Eid> => {
  let made = await g.apply([{
    entity: { eid: '$session' },
    session: { id: t.id },
  }])
  return made.find((b) => b.session)!.entity.eid
}

/**
 * Read what the log holds past the tail into its session, one transaction per
 * line, each dated when the harness wrote it where the line says. A line the
 * reader does not recognize, or one that is not JSON at all, becomes nothing:
 * the file keeps it. Answers how many lines were read.
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
  // The line the session's `consumed` stands at.
  let marked = t.line
  let breath = performance.now()
  let all = lines(t, o.final)
  for (let [i, text] of all.entries()) {
    if (o.signal?.aborted) {
      t.rest = [...all.slice(i), t.rest].join('\n')
      break
    }
    // A long read hands the event loop back every so often: the lease its duty
    // holds and every other duty in the process renew and fire on timers.
    if (performance.now() - breath > 50) {
      await new Promise((go) => setTimeout(go, 0))
      breath = performance.now()
    }
    let line = ++t.line
    let event = parsed(text)
    if (!event) continue
    let said = read(event)
    let kept = o.prose ? said.entries.filter(prose) : said.entries
    if (!kept.length && !said.about) continue
    t.session ??= await created(g, t)
    let bundles = imported(said, {
      ...o,
      session: t.session,
      source: t.path,
      line,
    })
    let own = {
      consumed: line,
      ...(!t.operator && kept.some(typed) ? { operator: true } : {}),
    }
    let mine = bundles.find((b) => b.entity.eid == t.session)
    if (mine) mine.session = { ...comp(mine, 'session'), ...own }
    else bundles.push({ entity: { eid: t.session }, session: own })
    t.operator ||= !!own.operator
    // Trusted: `imported` is server-owned, and this is the server reading a
    // file on its own machine. A line the graph refuses would be refused
    // again: it is reported and left in the file. Any other failure ends the
    // read, past lines this tail has already taken, so the caller opens a new
    // tail where the transcript stands.
    try {
      await g.apply(await settled(g, bundles), {
        trusted: true,
        ...(said.at ? { now: said.at } : {}),
      })
      marked = line
    } catch (e) {
      if (status(e) >= 500) throw e
      ;(o.report ?? console.error)(e)
    }
  }
  // Lines past the last that made an entry, or refused ones: read all the
  // same, so a resume starts after them.
  if (t.line > marked) {
    t.session ??= await created(g, t)
    await g.apply([{
      entity: { eid: t.session },
      session: { consumed: t.line },
    }], { trusted: true })
  }
  return t.line - from
}
