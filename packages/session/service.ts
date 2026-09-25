// The duty a host runs at `@yaks/session/service` for as long as it is up:
// every session a harness ran on this machine, read into the graph from the
// transcript file the harness keeps (./tail.ts).
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
// read in lazily, one file per pass, and only its prose. A session the graph
// has not met is created under the harness's id for it, and one a person typed
// into is marked `operator`, which is what tells the person's words apart from
// an agent's brief.
//
// A session whose transcript asks a provider for a run (`using{provider}` on
// an entry nobody imported) is a managed run: @yaks/spawn launched it and reads
// its stdout, and its transcript file is left alone. So are subagents'
// transcripts, under `<session>/subagents/`, which are not sessions of their
// own yet.

import type { Eid, Graph } from '@yaks/graph'
import { SESSION } from './comp.ts'
import { claude } from './readers.ts'
import { reapLeases } from './reap.ts'
import { pull, type Tail, tail } from './tail.ts'
import { sessionFor } from './who.ts'

/** What a config file can set for this plugin's duty. */
export type Options = {
  /** how often transcripts are looked at, in milliseconds (default one
   * second) */
  every?: number
  /** the Claude projects directory transcripts are read from (default
   * `~/.claude/projects`) */
  transcripts?: string
  /** how long after it was last written a transcript is read at full depth,
   * in milliseconds (default 14 days) */
  full?: number
}

/** How long a transcript is read at full depth once it stops being written. */
export let FULL = 14 * 24 * 60 * 60 * 1000

/** Where Claude keeps its transcripts on this machine. */
export let claudeProjects = (): string | undefined => {
  let env = globalThis.Deno?.env
  let root = env?.get('CLAUDE_CONFIG_DIR') ??
    (env?.get('HOME') ? `${env.get('HOME')}/.claude` : undefined)
  return root && `${root}/projects`
}

/** One transcript on disk: the harness's id for the session, and the file. */
export type Found = { id: string; path: string }

/** Every top-level transcript under a Claude projects directory. */
export let transcripts = (dir: string): Found[] => {
  let out: Found[] = []
  let list = (d: string) => {
    try {
      return [...Deno.readDirSync(d)]
    } catch {
      return []
    }
  }
  for (let project of list(dir)) {
    if (!project.isDirectory) continue
    for (let f of list(`${dir}/${project.name}`)) {
      if (!f.isFile || !f.name.endsWith('.jsonl')) continue
      out.push({
        id: f.name.slice(0, -'.jsonl'.length),
        path: `${dir}/${project.name}/${f.name}`,
      })
    }
  }
  return out
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

// A tail on a transcript, or null where its session is a managed run.
let opened = async (g: Graph, f: Found): Promise<Tail | null> => {
  let s = await sessionFor(g, f.id)
  if (s && await managed(g, s.entity.eid)) return null
  return tail(g, f.path, {
    ...(s ? { session: s.entity.eid } : {}),
    id: f.id,
    operator: !!(s?.[SESSION] as { operator?: boolean } | undefined)?.operator,
  })
}

let stat = (path: string) => {
  try {
    return Deno.statSync(path)
  } catch {
    return undefined
  }
}

/**
 * One look at every transcript under `dir`: each written to in the last
 * `full` milliseconds is read on to its end at full depth, and one older
 * transcript not yet read to its end is read in, its prose only.
 */
export let look = async (
  g: Graph,
  dir: string,
  seen: Seen,
  o: { person?: Eid; full?: number; now?: number } = {},
): Promise<void> => {
  let now = o.now ?? Date.now()
  let old: Found | undefined
  for (let f of transcripts(dir)) {
    let st = stat(f.path)
    let t = seen.tails.get(f.path)
    if (!st || t === null || (t && t.at >= st.size)) continue
    if (!t && now - (st.mtime?.getTime() ?? 0) >= (o.full ?? FULL)) {
      if (!seen.done.has(f.path)) old ??= f
      continue
    }
    t ??= await opened(g, f)
    seen.tails.set(f.path, t)
    // A tail a failure cut short is dropped, and the next look opens a new
    // one where the transcript stands.
    if (t) {
      await pull(g, t, claude, { person: o.person }).catch((e) => {
        seen.tails.delete(f.path)
        throw e
      })
    }
  }
  if (!old) return
  let t = await opened(g, old)
  if (t) await pull(g, t, claude, { person: o.person, prose: true })
  seen.done.add(old.path)
}

let sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((done) => {
    let timer = setTimeout(done, ms)
    signal.addEventListener('abort', () => {
      clearTimeout(timer)
      done()
    }, { once: true })
  })

/** Free the locks whose holder is gone, then read transcripts in until
 * `signal` aborts. A look that fails is logged and made again on the next
 * pass, where the transcript stands. What the config's `person` typed is
 * signed with them. */
export let service = async (
  host: { graph: Graph; config?: { person?: string } },
  options: Options = {},
  signal: AbortSignal = AbortSignal.abort(),
): Promise<void> => {
  await reapLeases(host.graph.storage)
  let dir = options.transcripts ?? claudeProjects()
  if (signal.aborted || !dir) return
  let said = host.config?.person
  let person = said && ((await host.graph.address([said])).get(said) ?? said)
  let seen: Seen = { tails: new Map(), done: new Set() }
  while (!signal.aborted) {
    try {
      await look(host.graph, dir, seen, {
        ...(person ? { person: person as Eid } : {}),
        full: options.full,
      })
    } catch (e) {
      console.error('transcripts —', e)
    }
    await sleep(options.every ?? 1000, signal)
  }
}
