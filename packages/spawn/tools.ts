// The implementations of the tools declared with `tool: true` in
// ./vocab.json, exported as `@yaks/spawn/tools`: hand an agent a task, stop it,
// wait for it to finish, and read what it has said so far.
//
// Spawn and stop write to the graph themselves. Wait and peek return rows for
// the tool runner to commit, but the child process does not exist until the
// transaction has committed, because ./effects.ts runs after the commit. So a
// tool that only returned the rows could not then watch what it started. This
// spawn call uses `graph.apply()`, signed as whoever asked, and returns the
// session's id — or, with `wait`, how the run ended. @yaks/process's `shell`
// tool works the same way, for the same reason.
//
// Waiting is polling. There is no separate notification channel: the wait asks
// the graph the same question a person would, only after committed data changes, until the run is over. Whether a run is over
// depends on what is behind the session — one with a `process` component ends
// when that process exits (a provider often prints its final event and then
// lingers, so its own `stop` entry does not mean the run ended), and one with
// no process ends when its transcript does.
//
// A timeout is not a kill. A run still going when the wait gives up is reported
// as still going and left alone; killing it is what `stop` is for.

import type { Bundle, Comp, Graph } from '@yaks/graph'
import { argsOf, who } from '@yaks/graph/call'
import { signed } from '@yaks/graph/provenance'
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
  sessionViews,
  statusOf,
  usingBefore,
} from '@yaks/session'
import { render } from '@yaks/text'
import { CallError } from '@yaks/tools/errors'
import { changes } from '@yaks/session/wait'
import { requestOf, spelling } from './run.ts'
import { reportOf } from './completion.ts'

/** What config can set for these tools. */
export type Options = {
  /** how often a wait re-reads the graph (ms, default 1000) */
  poll?: number
  /** how long a wait runs before it reports "still going" (default `30m`) */
  timeout?: string
  /** how many entries a peek shows (default 40) */
  lines?: number
}

/** What these tools are given: the open graph, and the signal that aborts
 * when the process answering them starts to stop. */
export type Host = { graph: Graph; stopping?: AbortSignal }

let uuid = () => crypto.randomUUID() as string
let str = (v: unknown): string => v == null ? '' : String(v)

let comp = (b: Bundle | undefined, name: string) =>
  b?.[name] as Comp | undefined

// A transcript-only wait ends when its current turn settles, stops or fails.
// A managed run is instead judged by the process exit (see `over`).
let ENDED = new Set(['settled', 'stopped', 'failed'])

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
    throw new CallError(
      'duration',
      `not a duration: ${raw} — say 45m, 2h, or seconds`,
    )
  }
  return Math.round(n * scale * 1000)
}

let one = async (g: Graph, eid: string): Promise<Bundle | undefined> =>
  (await g.get([eid]))[0]

let entriesOf = async (graph: Graph, session: string): Promise<Bundle[]> =>
  ordered(
    await graph.read(`.${ENTRY}.session=${JSON.stringify(session)}&*`),
  )

let recent = async (graph: Graph, session: string, limit: number) =>
  ordered(
    await graph.read(
      `.${ENTRY}.session=${JSON.stringify(session)}` +
        `&.order=-entry.seq&.limit=${limit}&*`,
    ),
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
export let briefOf = reportOf

// A run is over when whatever is behind it is over. A provider that prints its
// final event and then lingers has a `stop` entry and is still running, so a
// managed request also waits for the final import receipt.
let over = (row: Bundle | undefined, entries: Bundle[]): boolean => {
  if (!row?.[PROCESS]) return ENDED.has(statusOf(entries))
  if (comp(row, EXIT) == null) return false
  let request = entries.filter(requestOf).at(-1)
  return !request || entries.some((b) =>
    b.stop && !b.lines &&
    comp(b, 'ask')?.through == request.entity.eid &&
    Number(comp(b, ENTRY)?.seq) > Number(comp(request, ENTRY)?.seq)
  )
}

// Before final import receipts existed, an ended run's log was removed only
// after import. Those historical transcripts remain waitable after cleanup.
let cleaned = async (graph: Graph, row: Bundle, entries: Bundle[]) => {
  if (!row.process || !row.exit || !ENDED.has(statusOf(entries))) return false
  let file = comp(row, SESSION)?.transcript
  if (!file) return false
  let [source] = await graph.get([String(file)], ['file'])
  let path = comp(source, 'file')?.path
  if (typeof path != 'string' || !path.endsWith('.out')) return false
  try {
    await Deno.stat(path)
    return false
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return true
    throw error
  }
}

export let runs = (host: Host, options: Options = {}): Runs => {
  let beat = Number(options.poll ?? 1000)
  let patience = (said: unknown) =>
    every(said, every(options.timeout, 30 * 60_000))
  let lines = (said: unknown) => {
    let n = Number(said ?? options.lines ?? 40)
    if (!Number.isSafeInteger(n) || n < 1) {
      throw new CallError('lines', 'lines must be a positive integer')
    }
    return Math.min(n, 256)
  }

  // How a run ended, in a form a person reads: where it stands, the exit code
  // it ended on, and its own account of itself.
  let ending = (graph: Graph, row: Bundle, entries: Bundle[]): string => {
    let code = comp(row, EXIT)?.code
    let head = `${human(graph.vocab)(row)} — ${statusOf(entries)}` +
      (code == null ? '' : `, exited ${code}`)
    return [head, briefOf(row, entries)].filter(Boolean).join('\n')
  }

  // Re-read only when the committed revision changes, until the run is over,
  // the patience runs out, or the process answering it starts to stop, which
  // answers now rather than holding that stop: the caller asks again, of
  // whichever process answers next.
  let watched = async (
    graph: Graph,
    session: string,
    timeout: number,
  ): Promise<string> => {
    for await (
      let done of changes(graph, {
        every: beat,
        timeout,
        signal: host.stopping,
      })
    ) {
      let row = (await one(graph, session))!
      let entries = await entriesOf(graph, session)
      if (over(row, entries) || await cleaned(graph, row, entries)) {
        return ending(graph, row, entries)
      }
      let still = `${human(graph.vocab)(row)} — ${
        statusOf(entries)
      }, still running`
      if (host.stopping?.aborted) {
        return `${still}; this server is stopping, so wait again`
      }
      if (done) {
        return `${still} after ${Math.round(timeout / 1000)}s`
      }
    }
    throw new Error('wait ended without a final read')
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
      let persona = str(args.persona)
      let on = (await one(graph, task))!
      if (model && await spelling(graph, provider, model) == null) {
        throw new CallError(
          'model',
          `${str(args.provider)} does not serve ${str(args.model)}`,
        )
      }
      let effort = str(args.effort)
      let session = uuid()
      let parent = str(comp(call, ENTRY)?.session) || str(who(call)?.via)
      let owner = parent ? await one(graph, parent) : undefined
      let name = human(graph.vocab)(on)
      // Snapshot the task body into the request: the task is the brief, even
      // for a provider that has no graph tools in its own context.
      let instruction = [
        `Work ${name} in your own checkout. You already hold its claim under this session.`,
        `The task is your spec; read \`yak graph show ${name} --json\` for its current body.`,
        str(comp(on, 'doc')?.title),
        str(comp(on, 'doc')?.body),
        str(args.instruction),
      ].filter(Boolean).join('\n\n')
      // The request, plus the lease recording who is doing the work. The
      // lease is guarded, so handing an agent work somebody else already holds
      // rejects the whole transaction rather than starting a second run on
      // it.
      await graph.apply(
        signed([
          {
            entity: { eid: session },
            [SESSION]: {
              source: call.entity.eid,
              operator: false,
              ...(persona ? { persona } : {}),
            },
            ...owner?.session
              ? {
                spawned: {
                  parent,
                  ...call.entry ? { call: call.entity.eid } : {},
                },
              }
              : {},
          },
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
      name = human(graph.vocab)(row)
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

    session_stop: async (call, graph): Promise<Bundle[]> => {
      let row = await sessionAt(call, graph)
      let name = human(graph.vocab)(row)
      if (row.stop) return [said(call, `${name} already asked to stop`)]
      let managed = !!row[PROCESS]
      if (!managed) {
        let entries = await entriesOf(graph, row.entity.eid)
        if (statusOf(entries) == 'stopped') {
          return [said(call, `${name} already stopped`)]
        }
        let provider = await one(graph, str(usingBefore(entries)?.provider))
        managed = !row.native &&
          comp(provider, 'provider')?.transport == 'process'
      }
      await graph.apply(signed([{
        entity: { eid: managed ? row.entity.eid : uuid() },
        ...managed ? {} : { entry: { session: row.entity.eid } },
        stop: {},
      }], who(call)))
      return [said(call, `${name} asked to stop`)]
    },

    session_peek: async (call, graph): Promise<Bundle[]> => {
      let args = argsOf(call)
      let row = await sessionAt(call, graph)
      let shown = await recent(graph, row.entity.eid, lines(args.lines))
      let status = str(comp(row, SESSION)?.status) ||
        statusOf(await entriesOf(graph, row.entity.eid))
      return [said(
        call,
        [
          `${human(graph.vocab)(row)} — ${status}`,
          ...shown.map((b) =>
            render(sessionViews, b, 'Line', graph.vocab, {
              full: true,
              maxChars: 16_384,
            }, 'plain')
              .trim()
          ),
        ].join('\n'),
      )]
    },
  }
}
