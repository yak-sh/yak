// The turn spool, read into transcripts: the duty a host runs at
// `@yaks/session/service` for as long as it is up, and once on the way into a
// one-shot command.
//
// A harness hook appends each prompt and each final reply to the spool
// (./turn.ts), because a hook has milliseconds and opening the graph takes a
// second. This reads the lines back in the order they were written and appends
// each to its session's transcript: a prompt is an input, `content` with no
// `output` beside it, and a reply is `content` with `output`. A session the
// graph has not met yet is created under the harness's id for it, and one that
// a person typed into is marked `operator`, which is what tells the person's
// words apart from an agent's brief.
//
// Each entry's id is derived from its line, so reading a line twice writes the
// same entry twice, which changes nothing. That is what lets the spool be
// trimmed only after the entries are written: a crash in between repeats
// lines and loses none. Each is stamped with the time the hook ran, not the
// time it was read.
//
// A session that ran before the hooks were installed is read from Claude's own
// transcript file instead (./past.ts), into the same turns, written the same
// way: lazily, one file per pass of a long-running host.

import type { Bundle, Comp, Graph } from '@yaks/graph'
import { SESSION } from './comp.ts'
import { CONTENT, ENTRY, OUTPUT } from './native.ts'
import { claudeProjects, next, turnsOf } from './past.ts'
import { spoolOf, taken, trim, type Turn } from './turn.ts'
import { sessionFor } from './who.ts'

/** What a config file can set for this plugin's duty. */
export type Options = {
  /** the spool file (default `spool/turns.jsonl` beside the database) */
  spool?: string
  /** how often the spool is read, in milliseconds (default one second) */
  every?: number
  /** the Claude projects directory past transcripts are read from (default
   * `~/.claude/projects`) */
  transcripts?: string
}

// How long a host waits to look for past transcripts again once none is left.
let LOOK = 10 * 60 * 1000

let hex = (bytes: ArrayBuffer) =>
  [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0'))
    .join('')

// The entry a line becomes is named by the line itself.
let idOf = async (t: Turn): Promise<string> =>
  hex(
    await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(
        JSON.stringify([t.sid, t.at, t.input ?? null, t.output ?? null]),
      ),
    ),
  )

/**
 * The bundles a run of spool lines becomes: each session they name, created
 * where the graph has none and marked `operator` where a person typed into it,
 * then one transcript entry per line, in spool order.
 */
export let recorded = async (g: Graph, turns: Turn[]): Promise<Bundle[]> => {
  // Per harness id: the session's eid (an alias where it is new), whether it
  // is already marked `operator`, and what this batch writes on it.
  let seen = new Map<string, { eid: string; operator: boolean; own: Comp }>()
  let entries: Bundle[] = []
  for (let t of turns) {
    let s = seen.get(t.sid)
    if (!s) {
      let found = await sessionFor(g, t.sid)
      s = found
        ? {
          eid: found.entity.eid,
          operator: !!(found[SESSION] as Comp).operator,
          own: {},
        }
        : { eid: `$${t.sid}`, operator: false, own: { id: t.sid } }
      seen.set(t.sid, s)
    }
    if (t.input != null && !s.operator) s.operator = s.own.operator = true
    entries.push({
      entity: { eid: await idOf(t) },
      [ENTRY]: { session: s.eid },
      [CONTENT]: { body: t.input ?? t.output ?? '' },
      ...(t.output != null ? { [OUTPUT]: { source: s.eid } } : {}),
    })
  }
  let sessions = [...seen.values()].flatMap((s): Bundle[] =>
    Object.keys(s.own).length
      ? [{ entity: { eid: s.eid }, [SESSION]: s.own }]
      : []
  )
  return [...sessions, ...entries]
}

/** Write turns into their transcripts, each stamped with the moment it
 * happened rather than the moment it was read, so a person's words sort by
 * when they were said. */
export let record = async (g: Graph, turns: Turn[]): Promise<void> => {
  for (let t of turns) await g.apply(await recorded(g, [t]), { now: t.at })
}

/** Read the spool into the graph once, then trim what was written. Answers how
 * many lines it read. */
export let drain = async (g: Graph, path: string): Promise<number> => {
  let { turns, bytes } = taken(path)
  await record(g, turns)
  trim(path, bytes)
  return turns.length
}

/** Read one past transcript into the graph, if one is waiting (./past.ts).
 * Answers the session it read, or nothing. */
export let backfill = async (
  g: Graph,
  dir: string,
  known: Set<string>,
  now?: number,
): Promise<string | undefined> => {
  let past = await next(g, dir, known, now)
  if (!past) return undefined
  let lines = Deno.readTextFileSync(past.path).split('\n')
  await record(g, turnsOf(past.sid, lines))
  known.add(past.sid)
  return past.sid
}

let sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((done) => {
    let timer = setTimeout(done, ms)
    signal.addEventListener('abort', () => {
      clearTimeout(timer)
      done()
    }, { once: true })
  })

/** Read the spool into transcripts until `signal` aborts; an aborted signal
 * gets one pass. A pass that fails is logged and tried again on the next, so
 * the lines wait in the spool rather than being lost. Between passes, a
 * long-running host reads in one past transcript; once none is waiting, it
 * looks again every ten minutes. */
export let service = async (
  host: { graph: Graph; config?: { db?: string } },
  options: Options = {},
  signal: AbortSignal = AbortSignal.abort(),
): Promise<void> => {
  let path = options.spool ?? spoolOf(host.config?.db)
  if (!path) return
  let dir = options.transcripts ?? claudeProjects()
  let known = new Set<string>()
  let idle = 0
  for (;;) {
    try {
      await drain(host.graph, path)
    } catch (e) {
      console.error('turn spool —', e)
    }
    if (signal.aborted) return
    if (dir && Date.now() >= idle) {
      try {
        if (!await backfill(host.graph, dir, known)) idle = Date.now() + LOOK
      } catch (e) {
        console.error('transcript backfill —', e)
        idle = Date.now() + LOOK
      }
    }
    await sleep(options.every ?? 1000, signal)
  }
}
