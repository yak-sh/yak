// The implementations of the three tools declared with `tool: true` in
// ./vocab.json, exported as `@yaks/spawn/tools`: hand an agent a task, wait for
// it to finish, and read what it has said so far.
//
// Spawn writes to the graph itself. Every other tool here returns rows and lets
// the tool runner commit them, but the child process does not exist until the
// transaction has committed, because ./effects.ts runs after the commit. So a
// tool that only returned the rows could not then watch what it started. This
// one calls `graph.apply()` itself, signed as whoever asked, and returns the
// session's id — or, with `wait`, how the run ended. @yaks/process's `shell`
// tool works the same way, for the same reason.
//
// Waiting is polling. There is no separate notification channel: the wait asks
// the graph the same question a person would, on the same interval this package
// already reads its logs on, until the run is over. Whether a run is over
// depends on what is behind the session — one with a `process` component ends
// when that process exits (a provider often prints its final event and then
// lingers, so its own `stop` entry does not mean the run ended), and one with
// no process ends when its transcript does.
//
// A timeout is not a kill. A run still going when the wait gives up is reported
// as still going and left alone; killing it is what `stop` is for.

import {
  argsOf,
  type Bundle,
  type Comp,
  type Graph,
  signed,
  who,
} from '@yaks/graph'
import type { Runs } from '@yaks/graph/tools'
import { human } from '@yaks/id'
import { EXIT, PROCESS } from '@yaks/process'
import {
  CONTENT,
  ENTRY,
  ordered,
  OUTPUT,
  SESSION,
  sessionFor,
  statusOf,
  textOf,
  views,
} from '@yaks/session'
import { render } from '@yaks/text'
import { CallError } from '@yaks/tools'
import { spelling } from './run.ts'

/** What config can set for these tools. */
export type Options = {
  /** how often a wait re-reads the graph (ms, default 250 — the same beat
   * ./effects.ts reads a log on) */
  poll?: number
  /** how long a wait runs before it reports "still going" (default `30m`) */
  timeout?: string
  /** how many entries a peek shows (default 40) */
  lines?: number
}

/** What these tools are given: the open graph. */
export type Host = { graph: Graph }

let uuid = () => crypto.randomUUID() as string
let str = (v: unknown): string => v == null ? '' : String(v)
let sleep = (ms: number) => new Promise((go) => setTimeout(go, ms))

let comp = (b: Bundle | undefined, name: string) =>
  b?.[name] as Comp | undefined

// A transcript that is over: `stopped` means nothing more to do, `failed`
// means nothing that can be done. `settled` is neither — a turn that returned
// text is a run between turns.
let ENDED = new Set(['stopped', 'failed'])

/**
 * A duration written the way a person writes one: `45m`, `2h`, or bare
 * seconds.
 *
 * ```ts
 * import { every } from '@yaks/spawn/tools'
 *
 * every('45m', 0) // 2700000
 * every('', 1000) // 1000
 * ```
 */
export let every = (said: unknown, dflt: number): number => {
  let raw = str(said).trim()
  if (!raw) return dflt
  let scale = ({ s: 1, m: 60, h: 3600 } as Record<string, number>)[
    raw.slice(-1)
  ] ?? 1
  let n = Number(raw.replace(/[smh]$/, ''))
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`not a duration: ${raw} — say 45m, 2h, or seconds`)
  }
  return Math.round(n * scale * 1000)
}

let one = async (g: Graph, eid: string): Promise<Bundle | undefined> =>
  (await g.get([eid]))[0]

let entriesOf = async (graph: Graph, session: string): Promise<Bundle[]> =>
  ordered(
    await graph.read(`.${ENTRY}.session=${JSON.stringify(session)}&*`),
  )

// The session this call names, refused where the id is something else: a wait
// on a task is a wait that would never end.
let sessionAt = async (call: Bundle, graph: Graph): Promise<Bundle> => {
  let said = str(argsOf(call).session)
  let row = await sessionFor(graph, said)
  if (!row) throw new CallError('session', `not a session: ${said}`)
  return row
}

// A tool's text answer, as a row: its own entity, recording which call it came
// from. Every tool here answers in this shape.
let said = (call: Bundle, body: string): Bundle => ({
  entity: { eid: uuid() },
  content: { body },
  [OUTPUT]: { source: call.entity.eid },
})

/** A session's own account of itself: the brief it wrote if there is one,
 * otherwise the last thing it said. */
export let briefOf = (row: Bundle | undefined, entries: Bundle[]): string => {
  let wrote = str(comp(row, 'brief')?.text)
  if (wrote) return wrote
  let last = entries.filter((b) => b[OUTPUT] && b[CONTENT]).at(-1)
  return last ? textOf(last) : ''
}

// A run is over when whatever is behind it is over. A provider that prints its
// final event and then lingers has a `stop` entry and is still running, so a
// session with a `process` is judged by the process exiting and nothing else.
let over = (row: Bundle | undefined, entries: Bundle[]): boolean =>
  row?.[PROCESS] ? comp(row, EXIT) != null : ENDED.has(statusOf(entries))

export let runs = (_host: Host, options: Options = {}): Runs => {
  let beat = Number(options.poll ?? 250)
  let patience = (said: unknown) =>
    every(said, every(options.timeout, 30 * 60_000))
  let lines = (said: unknown) => Number(said ?? options.lines ?? 40)

  // How a run ended, in a form a person reads: where it stands, the exit code
  // it ended on, and its own account of itself.
  let ending = (graph: Graph, row: Bundle, entries: Bundle[]): string => {
    let code = comp(row, EXIT)?.code
    let head = `${human(graph.vocab)(row)} — ${statusOf(entries)}` +
      (code == null ? '' : `, exited ${code}`)
    return [head, briefOf(row, entries)].filter(Boolean).join('\n')
  }

  // The wait itself: the same two reads, on the beat, until the run is over
  // or the patience runs out.
  let watched = async (
    graph: Graph,
    session: string,
    timeout: number,
  ): Promise<string> => {
    for (let end = Date.now() + timeout;;) {
      let row = (await one(graph, session))!
      let entries = await entriesOf(graph, session)
      if (over(row, entries)) return ending(graph, row, entries)
      if (Date.now() >= end) {
        return `${human(graph.vocab)(row)} — ${
          statusOf(entries)
        }, still running after ${Math.round(timeout / 1000)}s`
      }
      await sleep(Math.min(beat, Math.max(0, end - Date.now())))
    }
  }

  return {
    session_spawn: async (call, graph): Promise<Bundle[]> => {
      // The task, the provider and the model arrive as the eids they name,
      // each already found to be one (@yaks/tools resolves every declared
      // reference); what is left to ask is whether this provider serves this
      // model.
      let args = argsOf(call)
      let task = str(args.task)
      let provider = str(args.provider)
      let model = str(args.model)
      let on = (await one(graph, task))!
      if (model && await spelling(graph, provider, model) == null) {
        throw new Error(
          `${str(args.provider)} does not serve ${str(args.model)}`,
        )
      }
      let effort = str(args.effort)
      let session = uuid()
      // The instruction names the work and no more: the session holds the
      // claim, and every session here starts by reading what it holds.
      let instruction = str(args.instruction) ||
        [human(graph.vocab)(on), str(comp(on, 'doc')?.title)]
          .filter(Boolean).join(' — ')
      // The request, plus the lease recording who is doing the work. The
      // lease is guarded, so handing an agent work somebody else already holds
      // rejects the whole transaction rather than starting a second run on
      // it.
      await graph.apply(
        signed([
          { entity: { eid: session }, [SESSION]: {} },
          {
            entity: { eid: uuid() },
            [ENTRY]: { session },
            [CONTENT]: { body: instruction },
            using: {
              provider,
              ...(model ? { model } : {}),
              ...(effort ? { effort } : {}),
            },
          },
          { entity: { eid: task }, claim: { session } },
        ], who(call)),
      )
      let row = (await one(graph, session))!
      let name = human(graph.vocab)(row)
      return [said(
        call,
        args.wait
          ? await watched(graph, session, patience(args.timeout))
          : `${name} spawned`,
      )]
    },

    session_wait: async (call, graph): Promise<Bundle[]> => {
      let args = argsOf(call)
      let row = await sessionAt(call, graph)
      return [said(
        call,
        await watched(graph, row.entity.eid, patience(args.timeout)),
      )]
    },

    session_peek: async (call, graph): Promise<Bundle[]> => {
      let args = argsOf(call)
      let row = await sessionAt(call, graph)
      let entries = await entriesOf(graph, row.entity.eid)
      let shown = entries.slice(-lines(args.lines))
      return [said(
        call,
        [
          `${human(graph.vocab)(row)} — ${statusOf(entries)}`,
          ...shown.map((b) =>
            render(views, b, 'Line', graph.vocab, {}, 'plain').trim()
          ),
        ].join('\n'),
      )]
    },
  }
}
