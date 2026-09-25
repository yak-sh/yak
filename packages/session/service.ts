// The turn spool, read into transcripts: the duty a host runs at
// `@yaks/session/service` for as long as it is up, and once on the way into a
// one-shot command.
//
// The duty opens by freeing the locks whose holder is gone (./reap.ts). Start-up
// is the one moment that answer is fresh, and holding the duty is what makes
// this process the one to give it: the lease is renewed for as long as the
// process that stays up runs, so a command started beside it leaves the reap
// to it rather than writing the same releases again.
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
import { claudeProjects, next, turnsOf, typedIn } from './past.ts'
import { reapLeases } from './reap.ts'
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

// How long an input waits in the spool for its harness to write it down, so
// the transcript can say whether a person typed it (./past.ts `typedIn`). Past
// that it is written unsigned: who typed it stays unknown.
export let WAIT = 30_000

// Whether a person typed the input, as its transcript says: `undefined` while
// the harness has not written it down.
let typedOf = (t: Turn): boolean | undefined =>
  t.transcript && t.promptId ? typedIn(t.transcript, t.promptId) : false

/**
 * The bundles a spool line becomes: its session, created where the graph has
 * none and marked `operator` where a person typed into it, then its transcript
 * entry. An input marked `typed` is signed with `person`, through the session
 * where it already exists.
 */
export let recorded = async (
  g: Graph,
  t: Turn,
  person?: string,
): Promise<Bundle[]> => {
  let found = await sessionFor(g, t.sid)
  let eid = found?.entity.eid ?? `$${t.sid}`
  let own: Comp = found ? {} : { id: t.sid }
  if (t.input != null && !(found?.[SESSION] as Comp | undefined)?.operator) {
    own.operator = true
  }
  let by = t.input != null && t.typed ? person : undefined
  return [
    ...(Object.keys(own).length ? [{ entity: { eid }, [SESSION]: own }] : []),
    {
      entity: { eid: await idOf(t) },
      [ENTRY]: { session: eid },
      [CONTENT]: { body: t.input ?? t.output ?? '' },
      ...(t.output != null ? { [OUTPUT]: { source: eid } } : {}),
      ...(by ? { $actor: { by, ...(found ? { via: eid } : {}) } } : {}),
    },
  ]
}

/** Write turns into their transcripts, each stamped with the moment it
 * happened rather than the moment it was read, so a person's words sort by
 * when they were said. */
export let record = async (
  g: Graph,
  turns: Turn[],
  person?: string,
): Promise<void> => {
  for (let t of turns) {
    await g.apply(await recorded(g, t, person), { now: t.at })
  }
}

/** Read the spool into the graph once, then trim what was written. Where
 * there is a `person` to sign with, each input is asked of its transcript; one
 * the harness has not written down yet stops the read there, for up to
 * {@link WAIT}, so it and the lines after it wait for the next pass. Answers
 * how many lines it wrote. */
export let drain = async (
  g: Graph,
  path: string,
  person?: string,
  now: number = Date.now(),
): Promise<number> => {
  let { turns, ends, bytes } = taken(path)
  let ready: Turn[] = []
  for (let t of turns) {
    let typed = person && t.input != null ? typedOf(t) : false
    if (typed === undefined && now - Date.parse(t.at) < WAIT) break
    ready.push({ ...t, typed: !!typed })
  }
  let n = ready.length
  await record(g, ready, person)
  trim(path, n < turns.length ? ends[n - 1] ?? 0 : bytes)
  return n
}

/** Read one past transcript into the graph, if one is waiting (./past.ts),
 * its typed prompts signed with `person`. Answers the session it read, or
 * nothing. */
export let backfill = async (
  g: Graph,
  dir: string,
  known: Set<string>,
  person?: string,
  now?: number,
): Promise<string | undefined> => {
  let past = await next(g, dir, known, now)
  if (!past) return undefined
  let lines = Deno.readTextFileSync(past.path).split('\n')
  await record(g, turnsOf(past.sid, lines), person)
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
 * looks again every ten minutes. What the config's `person` typed is signed
 * with them. */
export let service = async (
  host: { graph: Graph; config?: { db?: string; person?: string } },
  options: Options = {},
  signal: AbortSignal = AbortSignal.abort(),
): Promise<void> => {
  await reapLeases(host.graph.storage)
  let path = options.spool ?? spoolOf(host.config?.db)
  if (!path) return
  let dir = options.transcripts ?? claudeProjects()
  let known = new Set<string>()
  let idle = 0
  let said = host.config?.person
  let person = said && ((await host.graph.address([said])).get(said) ?? said)
  for (;;) {
    try {
      await drain(host.graph, path, person)
    } catch (e) {
      console.error('turn spool —', e)
    }
    if (signal.aborted) return
    if (dir && Date.now() >= idle) {
      try {
        if (!await backfill(host.graph, dir, known, person)) {
          idle = Date.now() + LOOK
        }
      } catch (e) {
        console.error('transcript backfill —', e)
        idle = Date.now() + LOOK
      }
    }
    await sleep(options.every ?? 1000, signal)
  }
}
