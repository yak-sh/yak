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

import { sleep } from '@yaks/fp'
import type { Bundle, Comp, Eid, Graph } from '@yaks/graph'
import { TOMBSTONE } from '@yaks/graph/bundle'
import { feed } from './bus.ts'
import { SESSION } from './comp.ts'
import { claude, codexRollout, subagent } from './readers.ts'
import { reapLeases } from './reap.ts'
import { behind, callOf, logOf, pull, type Tail, tail } from './tail.ts'
import { sessionEid, sessionFor } from './who.ts'
import { archive } from './archive.ts'
import {
  claudeProjects,
  codexSessions,
  type Found,
  header,
  rollouts,
  transcripts,
} from './files.ts'
export {
  claudeProjects,
  codexSessions,
  type Found,
  rollouts,
  transcripts,
} from './files.ts'

/** What a config file can set for this plugin's duty. */
export type Options = {
  /** how often transcripts are looked at, in milliseconds (default one
   * second) */
  every?: number
  /** the Claude projects directory transcripts are read from (default
   * `~/.claude/projects`) */
  transcripts?: string
  /** Codex sessions directory (default `$CODEX_HOME/sessions` or
   * `~/.codex/sessions`). */
  codex?: string
  /** how long a session keeps its full depth after it was last written, in
   * milliseconds (default 14 days) */
  full?: number
}

/** How long a session keeps its full depth once it stops being written. */
export let FULL = 14 * 24 * 60 * 60 * 1000

/** What one process knows about the files it reads: the tail on each one it
 * follows (`null` for a managed run's), and the older ones read to the end. */
export type Seen = {
  tails: Map<string, Tail | null>
  done: Set<string>
  versions?: Map<string, string>
  retry?: Map<string, number>
  turns?: Map<string, number>
  turn?: number
}

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
  let [s] = await g.get([eid], ['spawned'])
  if (s?.spawned && s[TOMBSTONE] == null) return eid
  let parent = (await sessionFor(g, f.parent, ['session.id']))?.entity.eid
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
let opened = async (
  g: Graph,
  f: Found,
  signal?: AbortSignal,
): Promise<Tail | null> => {
  if (f.runner == 'codex') {
    let s = await sessionFor(g, f.id, ['session.id'])
    if (s && await managed(g, s.entity.eid)) return null
    let version = f.path.endsWith('.zst') ? versionOf(stat(f.path)) : undefined
    let [log] = version ? await g.get([logOf(f.path)]) : []
    if (version && (log?.log as Comp | undefined)?.finished == version) {
      return null
    }
    let stream = version ? archive(f.path, signal) : undefined
    let prefix = ''
    let meta: Record<string, unknown>
    try {
      if (stream) {
        while (
          !prefix.includes('\n') && !stream.done && !signal?.aborted &&
          prefix.length < 1024 * 1024
        ) {
          prefix += await stream.read() ?? ''
        }
        try {
          meta = JSON.parse(prefix.split('\n')[0]).payload ?? {}
        } catch {
          meta = {}
        }
      } else meta = header(f.path)
      if (signal?.aborted) {
        await stream?.close()
        return null
      }
      let source = meta.source as {
        subagent?: { thread_spawn?: { parent_thread_id?: string } }
      } | undefined
      f.parent = source?.subagent?.thread_spawn?.parent_thread_id
      let eid = sessionEid(f.id)
      let parent = f.parent && sessionEid(f.parent)
      await g.apply([
        ...(parent
          ? [{ entity: { eid: parent }, session: { id: f.parent } }]
          : []),
        {
          entity: { eid },
          session: { id: f.id, ...(parent ? { operator: false } : {}) },
          ...(parent ? { spawned: { parent } } : {}),
        },
      ], { trusted: true })
      return await tail(g, f.path, {
        session: eid,
        id: f.id,
        stream,
        prefix,
        version,
      })
    } catch (error) {
      await stream?.close()
      throw error
    }
  }
  if (f.parent) {
    return tail(g, f.path, {
      session: await spawned(g, { ...f, parent: f.parent }),
      id: f.id,
    })
  }
  let s = await sessionFor(g, f.id, ['session.id'])
  if (s && await managed(g, s.entity.eid)) return null
  return tail(g, f.path, {
    ...(s ? { session: s.entity.eid } : {}),
    id: f.id,
  })
}

// How a transcript's lines read: a subagent's are all side conversations.
let format = (f: Found, t: Tail) =>
  f.runner == 'codex'
    ? (e: Parameters<typeof codexRollout>[0]) => {
      let said = codexRollout(e)
      if (
        e.type == 'session_meta' &&
        (e.payload as { id?: string })?.id != f.id
      ) return { entries: [] }
      if (f.parent || t.operator === false) {
        said.entries = said.entries.map((c) =>
          c.content && !c.output && !c.result ? { ...c, notice: {} } : c
        )
      }
      return said
    }
    : f.parent
    ? subagent
    : claude

let stat = (path: string) => {
  try {
    return Deno.statSync(path)
  } catch {
    return undefined
  }
}

let versionOf = (file: Deno.FileInfo | undefined) =>
  file ? `${file.size}:${file.mtime?.getTime() ?? 0}` : ''

let pending = (t: Tail, size: number) =>
  behind(t) || (t.stream ? !t.stream.done : t.at < size)

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
    codex?: string
    full?: number
    now?: number
    signal?: AbortSignal
    slice?: number
    budget?: number
    report?: (error: unknown) => void
  } = {},
): Promise<void> => {
  let now = o.now ?? Date.now()
  let start = performance.now()
  let spent = () => performance.now() - start >= (o.budget ?? BUDGET)
  type Due = { f: Found; lag?: number; at: number; prose?: boolean }
  let old: Due | undefined
  let read = () => ({
    person: o.person,
    signal: o.signal,
    until: performance.now() + (o.slice ?? SLICE),
  })
  // Each transcript with lines to read: how far behind a tail on it is, or
  // when it was written where none is open yet.
  let owed: Due[] = []
  for (let f of [...transcripts(dir), ...o.codex ? rollouts(o.codex) : []]) {
    let st = stat(f.path)
    let t = seen.tails.get(f.path)
    if (f.path.endsWith('.zst')) {
      let version = versionOf(st)
      seen.versions ??= new Map()
      if (seen.versions.has(f.path) && seen.versions.get(f.path) != version) {
        await t?.stream?.close()
        seen.tails.delete(f.path)
        seen.done.delete(f.path)
        seen.retry?.delete(f.path)
        t = undefined
      }
      seen.versions.set(f.path, version)
    }
    if ((seen.retry?.get(f.path) ?? 0) > now) continue
    let at = st?.mtime?.getTime() ?? 0
    if (!st || t === null || (t && !pending(t, st.size))) continue
    if (now - at >= (o.full ?? FULL)) {
      if (!seen.done.has(f.path)) old ??= { f, at, prose: true }
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
  // One slice cannot be monopolized by growing tails. The rest of the look
  // retains live priority; a cold source and old backfill both get a turn.
  let turns = seen.turns ??= new Map()
  let candidates = [...owed, ...old ? [old] : []].filter(({ f }) =>
    !f.parent || !owed.some((parent) =>
      parent.f.id == f.parent &&
      !parent.f.parent && !seen.tails.has(parent.f.path)
    )
  )
  // New sources join behind those already waiting, including when the old
  // backfill finishes a small file and discovers the next one.
  for (let { f } of candidates.toSorted((a, b) => a.at - b.at)) {
    if (!turns.has(f.path)) turns.set(f.path, seen.turn = (seen.turn ?? 0) + 1)
  }
  let fair =
    candidates.sort((a, b) => turns.get(a.f.path)! - turns.get(b.f.path)!)[0]
  if (fair) {
    owed = [fair, ...owed.filter((d) => d != fair)]
    if (fair == old) old = undefined
  }
  for (let [i, { f, prose }] of owed.entries()) {
    if (o.signal?.aborted || i && spent()) return
    let t = seen.tails.get(f.path)
    try {
      t ??= await opened(g, f, o.signal)
      seen.tails.set(f.path, t)
      if (t) await pull(g, t, format(f, t), { ...read(), prose })
      turns.set(f.path, seen.turn = (seen.turn ?? 0) + 1)
      if (
        prose && !o.signal?.aborted &&
        !(t && pending(t, stat(f.path)?.size ?? 0))
      ) {
        seen.done.add(f.path)
        seen.tails.delete(f.path)
      }
    } catch (error) {
      seen.tails.delete(f.path)
      await t?.stream?.close()
      if (!f.path.endsWith('.zst')) throw error
      ;(seen.retry ??= new Map()).set(f.path, now + 60000)
      ;(o.report ?? console.error)(error)
    }
  }
  if (!old || o.signal?.aborted || owed.length && spent()) return
  // Keep the cursor and unread bytes between backfill slices.
  let f = old.f
  let t = seen.tails.get(f.path)
  try {
    t ??= await opened(g, f, o.signal)
    seen.tails.set(f.path, t)
    if (t) await pull(g, t, format(f, t), { ...read(), prose: true })
    turns.set(f.path, seen.turn = (seen.turn ?? 0) + 1)
  } catch (error) {
    seen.tails.delete(f.path)
    await t?.stream?.close()
    if (!f.path.endsWith('.zst')) throw error
    ;(seen.retry ??= new Map()).set(f.path, now + 60000)
    ;(o.report ?? console.error)(error)
    return
  }
  if (!o.signal?.aborted && !(t && pending(t, stat(f.path)?.size ?? 0))) {
    seen.done.add(f.path)
    seen.tails.delete(f.path)
  }
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
  'refusal',
  'exception',
  'stop',
  'usage',
]
let stripped = (g: Graph) =>
  `.imported&!using${g.vocab.comp('cost') ? '&!cost' : ''}&(${
    ['!content', ...STRIPPED.filter((c) => g.vocab.comp(c)).map((c) => `.${c}`)]
      .join('|')
  })`

/**
 * One bounded page of imported entries to strip from a quiet session. Empty
 * pages give the duty its turn back after a recent or already stripped session.
 * The newest entry is checked before every page, so a session that speaks again
 * keeps its remaining depth. Identity cursors survive the entries' deletion.
 */
export let stale = async function* (
  g: Graph,
  o: { full?: number; now?: number; signal?: AbortSignal } = {},
): AsyncGenerator<Eid[]> {
  let before = new Date((o.now ?? Date.now()) - (o.full ?? FULL))
    .toISOString()
  let page = (query: string, after?: Eid, limit = 1) =>
    `${query} .fields=entity.eid .order=entity.eid .limit=${limit}${
      after ? ` .after=${after}` : ''
    }`
  let after: Eid | undefined
  while (!o.signal?.aborted) {
    let [found] = await g.rows(
      page('.session', after),
    ) as { eid: Eid }[]
    if (!found) return
    after = found.eid
    let cursor: Eid | undefined
    while (!o.signal?.aborted) {
      let [last] = await g.rows(
        `.entry.session=${after} .order=-entry.seq .limit=1 .fields=created.at`,
      ) as { 'created.at'?: string }[]
      if ((last?.['created.at'] ?? '') >= before) break
      let rows = await g.rows(
        page(`${stripped(g)} .entry.session=${after}`, cursor, BATCH),
      ) as { eid: Eid }[]
      if (!rows.length) break
      cursor = rows[rows.length - 1].eid
      yield rows.map((b) => b.eid)
    }
    yield []
  }
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
  let codex = options.codex ?? codexSessions()
  if (signal.aborted) return
  let said = host.config?.person
  let person = said && ((await host.graph.address([said])).get(said) ?? said)
  let seen: Seen = { tails: new Map(), done: new Set() }
  let trimming: AsyncGenerator<Eid[]> | undefined
  let due = 0
  try {
    while (!signal.aborted) {
      try {
        await feed(host.graph)
        if (dir || codex) {
          await look(host.graph, dir ?? '', seen, {
            codex,
            ...(person ? { person: person as Eid } : {}),
            full: options.full,
            signal,
          })
        }
        if (!trimming && Date.now() >= due) {
          trimming = stale(host.graph, { full: options.full, signal })
        }
        if (trimming) {
          let page: IteratorResult<Eid[]>
          try {
            page = await trimming.next()
          } catch (e) {
            trimming = undefined
            throw e
          }
          if (page.done) {
            trimming = undefined
            due = Date.now() + HOUR
          } else {
            // The iterator has advanced before deletion, so a failed page is
            // skipped until the next hourly pass rather than retried forever.
            await strip(host.graph, page.value)
          }
        }
      } catch (e) {
        console.error('transcripts —', e)
      }
      await sleep(options.every ?? 1000, signal)
    }
  } finally {
    await Promise.all([...seen.tails.values()].map((t) => t?.stream?.close()))
  }
}
