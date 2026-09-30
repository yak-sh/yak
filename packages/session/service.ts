// The duty a host runs at `@yaks/session/service` for as long as it is up:
// every session a harness ran on this machine, read into the graph from the
// transcript file the harness keeps (./tail.ts), and pending addressed items
// delivered to native sessions (./bus.ts).
//
// The duty opens by freeing the locks whose holder is gone (./reap.ts). Start-up
// is the one moment that answer is fresh, and holding the duty is what makes
// this process the one to give it: the lease is renewed for as long as the
// process that stays up runs, so a command started beside it leaves the reap
// to it rather than writing the same releases again. A one-shot command reaps
// and reads nothing: its tails would outlive the lease it gives back.
//
// Claude Code keeps each session as `<project>/<session>.jsonl` under its
// projects directory, and appends to it as the session runs. A transcript
// written to in the last `full` days is followed as it grows, at full depth:
// what the person typed, what the harness put in front of the model, what the
// model said and thought, and every tool call with its result. An older one is
// read in lazily, one file per pass, and only its prose. A look reads each
// file for a slice of time, so a long backlog is read over many looks and what
// a live session says never waits behind it. A session the graph has not met
// is created under the harness's id for it, and one a person typed into is
// marked `operator`, which is what tells the person's words apart from an
// agent's brief.
//
// A session whose transcript asks a provider for a run (`using{provider}` on
// an entry nobody imported) is a managed run: @yaks/spawn launched it and reads
// its stdout, and its transcript file is left alone.
//
// A subagent keeps a transcript of its own, `<session>/subagents/agent-<id>.jsonl`
// beside its parent's, and is a session of its own: spawned by the session
// whose directory holds it, from the call its `agent-<id>.meta.json` names,
// and read like any other, as it is written.
//
// A session keeps its full depth for `full` days after it last said anything.
// Once an hour the duty finds every imported session older than that, from
// whichever importer, and strips it to its prose: each imported entry the
// prose-only read would have left out goes, a small batch between looks, so
// what a session says now never waits behind it. What a person typed and what
// the model said stay, and so does everything nobody imported.

import { type Bundle, type Eid, type Graph, TOMBSTONE } from '@yaks/graph'
import { feed } from './bus.ts'
import { SESSION } from './comp.ts'
import { claude, subagent } from './readers.ts'
import { reapLeases } from './reap.ts'
import { behind, callOf, pull, type Tail, tail } from './tail.ts'
import { sessionEid, sessionFor } from './who.ts'

/** What a config file can set for this plugin's duty. */
export type Options = {
  /** how often transcripts are looked at, in milliseconds (default one
   * second) */
  every?: number
  /** the Claude projects directory transcripts are read from (default
   * `~/.claude/projects`) */
  transcripts?: string
  /** how long a session keeps its full depth after it was last written, in
   * milliseconds (default 14 days) */
  full?: number
}

/** How long a session keeps its full depth once it stops being written. */
export let FULL = 14 * 24 * 60 * 60 * 1000

/** Where Claude keeps its transcripts on this machine. */
export let claudeProjects = (): string | undefined => {
  let env = globalThis.Deno?.env
  let root = env?.get('CLAUDE_CONFIG_DIR') ??
    (env?.get('HOME') ? `${env.get('HOME')}/.claude` : undefined)
  return root && `${root}/projects`
}

/** One transcript on disk: the harness's id for the session, and the file. */
export type Found = {
  id: string
  path: string
  /** a subagent's: the harness's id for the session that started it */
  parent?: string
}

/** Every transcript under a Claude projects directory: the sessions', then
 * their subagents'. */
export let transcripts = (dir: string): Found[] => {
  let out: Found[] = []
  let agents: Found[] = []
  let list = (d: string) => {
    try {
      return [...Deno.readDirSync(d)]
    } catch {
      return []
    }
  }
  for (let project of list(dir)) {
    if (!project.isDirectory) continue
    let at = `${dir}/${project.name}`
    for (let f of list(at)) {
      if (f.isFile && f.name.endsWith('.jsonl')) {
        out.push({
          id: f.name.slice(0, -'.jsonl'.length),
          path: `${at}/${f.name}`,
        })
      }
      if (!f.isDirectory) continue
      for (let a of list(`${at}/${f.name}/subagents`)) {
        let id = a.name.match(/^agent-(.+)\.jsonl$/)?.[1]
        if (!a.isFile || !id) continue
        let path = `${at}/${f.name}/subagents/${a.name}`
        agents.push({ id, path, parent: f.name })
      }
    }
  }
  return [...out, ...agents]
}

/** What one process knows about the files it reads: the tail on each one it
 * follows (`null` for a managed run's), and the older ones read to the end. */
export type Seen = { tails: Map<string, Tail | null>; done: Set<string> }

/** Whether a session is a managed run: its transcript asks a provider for
 * one, which is the request @yaks/spawn answers. */
export let managed = async (g: Graph, session: Eid): Promise<boolean> =>
  (await g.read(
    `.entry.session=${session}&.using.provider&!imported&.limit=1`,
  )).length > 0

// The call a subagent was started by, as the harness names it in the meta
// file beside the transcript.
let startedBy = (path: string): string | undefined => {
  try {
    let meta = JSON.parse(
      Deno.readTextFileSync(`${path.slice(0, -'.jsonl'.length)}.meta.json`),
    )
    return typeof meta?.toolUseId == 'string' ? meta.toolUseId : undefined
  } catch {
    return undefined // no meta file: the link names no call
  }
}

// A subagent's session, linked to the session that started it and to the call
// that did, where the graph holds it: written the first time its transcript
// is opened, with the parent where the graph has not met it yet.
let spawned = async (g: Graph, f: Found & { parent: string }) => {
  let eid = sessionEid(f.id, f.parent)
  let [s] = await g.get([eid])
  if (s?.spawned && s[TOMBSTONE] == null) return eid
  let parent = (await sessionFor(g, f.parent))?.entity.eid
  let id = startedBy(f.path)
  let call = parent && id ? callOf(parent, id) : undefined
  let [made] = call ? await g.get([call]) : []
  await g.apply([
    ...parent
      ? []
      : [{ entity: { eid: '$parent' }, [SESSION]: { id: f.parent } }],
    {
      entity: { eid },
      [SESSION]: { id: f.id },
      spawned: {
        parent: parent ?? '$parent',
        ...made?.entry && made[TOMBSTONE] == null ? { call } : {},
      },
    },
  ] as Bundle[])
  return eid
}

// A tail on a transcript, or null where its session is a managed run.
let opened = async (g: Graph, f: Found): Promise<Tail | null> => {
  if (f.parent) {
    return tail(g, f.path, {
      session: await spawned(g, { ...f, parent: f.parent }),
      id: f.id,
    })
  }
  let s = await sessionFor(g, f.id)
  if (s && await managed(g, s.entity.eid)) return null
  return tail(g, f.path, {
    ...(s ? { session: s.entity.eid } : {}),
    id: f.id,
    operator: !!(s?.[SESSION] as { operator?: boolean } | undefined)?.operator,
  })
}

// How a transcript's lines read: a subagent's are all side conversations.
let format = (f: Found) => f.parent ? subagent : claude

let stat = (path: string) => {
  try {
    return Deno.statSync(path)
  } catch {
    return undefined
  }
}

/** How long a look reads one transcript before it turns to the next, in
 * milliseconds. */
export let SLICE = 100

/** How long one look reads in all, in milliseconds. */
export let BUDGET = 1000

/**
 * One look at every transcript under `dir`: each written to in the last
 * `full` milliseconds is read on at full depth, and one older transcript not
 * yet read to its end is read in, its prose only. The one least behind is read
 * first, each for a `slice` (and at least a line), until the look has read for
 * its `budget`: a long backlog is read over many looks, and what a live
 * session says next never waits behind it. A look whose `signal` aborts stops
 * between lines, and the next process reads on from there.
 */
export let look = async (
  g: Graph,
  dir: string,
  seen: Seen,
  o: {
    person?: Eid
    full?: number
    now?: number
    signal?: AbortSignal
    slice?: number
    budget?: number
  } = {},
): Promise<void> => {
  let now = o.now ?? Date.now()
  let start = performance.now()
  let spent = () => performance.now() - start >= (o.budget ?? BUDGET)
  let old: Found | undefined
  let read = () => ({
    person: o.person,
    signal: o.signal,
    until: performance.now() + (o.slice ?? SLICE),
  })
  // Each transcript with lines to read: how far behind a tail on it is, or
  // when it was written where none is open yet.
  let owed: { f: Found; lag?: number; at: number }[] = []
  for (let f of transcripts(dir)) {
    let st = stat(f.path)
    let t = seen.tails.get(f.path)
    let at = st?.mtime?.getTime() ?? 0
    if (!st || t === null || (t && t.at >= st.size && !behind(t))) continue
    if (!t && now - at >= (o.full ?? FULL)) {
      if (!seen.done.has(f.path)) old ??= f
      continue
    }
    owed.push({ f, at, ...t ? { lag: st.size - t.at + t.rest.length } : {} })
  }
  // The tails already open, least behind first, then the rest, most recently
  // written first: a live session's next lines lead every look. Of the rest,
  // sessions come before subagents, as `transcripts()` lists them: a subagent
  // writes after the call that started it, so its transcript is the newer one,
  // and opened first it would find no call to link to.
  owed.sort((a, b) =>
    a.lag != null && b.lag != null
      ? a.lag - b.lag
      : a.lag != null
      ? -1
      : b.lag != null
      ? 1
      : Number(!!a.f.parent) - Number(!!b.f.parent) || b.at - a.at
  )
  for (let [i, { f }] of owed.entries()) {
    if (o.signal?.aborted || i && spent()) return
    let t = seen.tails.get(f.path) ?? await opened(g, f)
    seen.tails.set(f.path, t)
    // A tail a failure cut short is dropped, and the next look opens a new
    // one where the transcript stands.
    if (t) {
      await pull(g, t, format(f), read()).catch((e) => {
        seen.tails.delete(f.path)
        throw e
      })
    }
  }
  if (!old || o.signal?.aborted || owed.length && spent()) return
  let t = await opened(g, old)
  if (t) await pull(g, t, format(old), { ...read(), prose: true })
  if (!o.signal?.aborted && !(t && behind(t))) seen.done.add(old.path)
}

// What a strip takes from an imported entry: all of it where there is no
// prose (a call), and each whose prose sits beside a kind the prose-only read
// leaves out (`prose` in ./tail.ts), of the kinds the vocabulary has. An entry
// that records what a turn cost stays, since the session's `cost` is its sum.
let STRIPPED = [
  'reasoning',
  'notice',
  'result',
  'error',
  'exception',
  'stop',
  'usage',
]
let stripped = (g: Graph) =>
  `.imported${g.vocab.comp('cost') ? '&!cost' : ''}&(${
    ['!content', ...STRIPPED.filter((c) => g.vocab.comp(c)).map((c) => `.${c}`)]
      .join('|')
  })`

/**
 * What a strip owes: each imported entry that is not prose, in a session whose
 * newest entry was written more than `full` milliseconds before `now`.
 */
export let stale = async (
  g: Graph,
  o: { full?: number; now?: number } = {},
): Promise<Eid[]> => {
  let before = new Date((o.now ?? Date.now()) - (o.full ?? FULL))
    .toISOString()
  let by = new Map<Eid, Eid[]>()
  for (let b of await g.read(`${stripped(g)}&?entry.session`)) {
    let session = (b.entry as { session: Eid }).session
    if (!by.has(session)) by.set(session, [])
    by.get(session)!.push(b.entity.eid)
  }
  let out: Eid[] = []
  for (let [session, eids] of by) {
    let [last] = await g.read(
      `.entry.session=${session}&.order=-entry.seq&.limit=1&?created`,
    )
    let at = (last?.created as { at?: string } | undefined)?.at ?? ''
    if (at < before) out.push(...eids)
  }
  return out
}

/** How many entries one step of a strip deletes. */
export let BATCH = 50

/** One step of a strip: these entries, deleted. */
export let strip = async (g: Graph, eids: Eid[]): Promise<void> => {
  if (eids.length) {
    await g.apply(eids.map((eid) => ({ entity: { eid }, $delete: true })))
  }
}

// How often the duty looks for sessions to strip.
let HOUR = 60 * 60 * 1000

let sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((done) => {
    let timer = setTimeout(done, ms)
    signal.addEventListener('abort', () => {
      clearTimeout(timer)
      done()
    }, { once: true })
  })

/** Free the locks whose holder is gone, then read transcripts in and strip
 * the stale sessions until `signal` aborts. A pass that fails is logged and
 * made again on the next, where the transcript stands. What the config's
 * `person` typed is signed with them. */
export let service = async (
  host: { graph: Graph; config?: { person?: string } },
  options: Options = {},
  signal: AbortSignal = AbortSignal.abort(),
): Promise<void> => {
  await reapLeases(host.graph.storage)
  let dir = options.transcripts ?? claudeProjects()
  if (signal.aborted) return
  let said = host.config?.person
  let person = said && ((await host.graph.address([said])).get(said) ?? said)
  let seen: Seen = { tails: new Map(), done: new Set() }
  let owed: Eid[] = []
  let due = 0
  while (!signal.aborted) {
    try {
      await feed(host.graph)
      if (dir) {
        await look(host.graph, dir, seen, {
          ...(person ? { person: person as Eid } : {}),
          full: options.full,
          signal,
        })
      }
      if (!owed.length && Date.now() >= due) {
        owed = await stale(host.graph, { full: options.full })
        due = Date.now() + HOUR
      }
      // Taken off the list before the delete, so a batch that fails is
      // dropped rather than tried every pass; the next hour finds it again.
      await strip(host.graph, owed.splice(0, BATCH))
    } catch (e) {
      console.error('transcripts —', e)
    }
    await sleep(options.every ?? 1000, signal)
  }
}
