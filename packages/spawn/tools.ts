// What anybody may ask about a managed session: the `tools` facet a host takes
// (`@yaks/spawn/tools`) — the runs behind the `tool: true` declarations in
// ./vocab.json. Three words: hand an agent a task, wait for what it came to,
// and glance at what it has said so far.
//
// A SPAWN IS AN ACT, not a patch. Every other tool here answers with bundles
// and lets the runner land them, but the agent does not exist until the
// request has COMMITTED — ./effects.ts answers the commit, not the intention —
// so a tool that only described the request could never watch what it started.
// This one lands its own batch, signed as whoever asked, and then answers: the
// session's id, or, with `wait`, the ending it watched. It is the shape
// @yaks/process's `shell` already has, for the same reason.
//
// WAITING IS READING, ON A BEAT. There is no second channel: the wait asks the
// graph the same question a person would, on the poll this plugin already
// reads its logs on, until the run is over. What "over" means depends on what
// is behind the transcript — a session with a process ends when the PROCESS
// ends (a provider prints its terminal event and can still linger, so its own
// `stop` entry is not the run ending), and one with none ends when the
// transcript does.
//
// A timeout is not a kill. A run still going when the wait gives up is
// answered as still going and left alone; ending it is `stop`'s job, which is
// a different sentence.

import {
  addressed,
  type Bundle,
  type Comp,
  type Graph,
  signed,
  type ToolCtx,
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
  statusOf,
  textOf,
  views,
} from '@yaks/session'
import { render } from '@yaks/text'

/** What a config says to these tools. */
export type Options = {
  /** how often a wait re-reads the graph (ms, default 250 — the same beat
   * ./effects.ts reads a log on) */
  poll?: number
  /** how long a wait runs before it answers "still going" (default `30m`) */
  timeout?: string
  /** how many entries a peek shows (default 40) */
  lines?: number
}

/** What the facet is handed: the graph, once it is open. */
export type Host = { graph: Graph }

let uuid = () => crypto.randomUUID() as string
let str = (v: unknown): string => v == null ? '' : String(v)
let sleep = (ms: number) => new Promise((go) => setTimeout(go, ms))

let comp = (b: Bundle | undefined, name: string) =>
  b?.[name] as Comp | undefined

// A transcript that is over: `stopped` is nothing more to do and `failed` is
// nothing that can be done. `settled` is neither — a turn that returned prose
// is a run between turns.
let ENDED = new Set(['stopped', 'failed'])

/**
 * A duration as a person says it: `45m`, `2h`, or bare seconds.
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
  (await g.storage.tx((tx) => tx.get([eid])))[0]

let entriesOf = async (ctx: ToolCtx, session: string): Promise<Bundle[]> =>
  ordered(await ctx.read(`.${ENTRY}.session=${JSON.stringify(session)}`))

// The session this call names, refused where the id is something else: a wait
// on a task is a wait that would never end.
let sessionAt = async (ctx: ToolCtx): Promise<Bundle> => {
  let said = str(ctx.args.session)
  let [eid] = await addressed(ctx.graph, [said])
  let row = await one(ctx.graph, eid)
  if (!row?.[SESSION]) throw new Error(`not a session: ${said}`)
  return row
}

// Prose, as the bundle that IS the answer: its own entity, saying which call
// it came from — the shape a tool's words always take here.
let said = (ctx: ToolCtx, body: string): Bundle => ({
  entity: { eid: uuid() },
  content: { body },
  [OUTPUT]: { source: ctx.call },
})

/** What a session's own account of itself is, in this order: the brief it
 * wrote, else the last thing it said. */
export let briefOf = (row: Bundle | undefined, entries: Bundle[]): string => {
  let wrote = str(comp(row, 'brief')?.text)
  if (wrote) return wrote
  let last = entries.filter((b) => b[OUTPUT] && b[CONTENT]).at(-1)
  return last ? textOf(last) : ''
}

// A run is over when the thing behind it is. A provider that prints its
// terminal event and lingers has a `stop` entry and is still running, so a
// transcript with a PROCESS is read by the process's ending and nothing else.
let over = (row: Bundle | undefined, entries: Bundle[]): boolean =>
  row?.[PROCESS] ? comp(row, EXIT) != null : ENDED.has(statusOf(entries))

export let runs = (_host: Host, options: Options = {}): Runs => {
  let beat = Number(options.poll ?? 250)
  let patience = (said: unknown) =>
    every(said, every(options.timeout, 30 * 60_000))
  let lines = (said: unknown) => Number(said ?? options.lines ?? 40)

  // What a run came to, in the words a person reads: where it stands, the
  // code it ended on, and its own account of itself.
  let ending = (ctx: ToolCtx, row: Bundle, entries: Bundle[]): string => {
    let code = comp(row, EXIT)?.code
    let head = `${human(ctx.graph.vocab)(row)} — ${statusOf(entries)}` +
      (code == null ? '' : `, exited ${code}`)
    return [head, briefOf(row, entries)].filter(Boolean).join('\n')
  }

  // The wait itself: the same two reads, on the beat, until the run is over
  // or the patience runs out.
  let watched = async (
    ctx: ToolCtx,
    session: string,
    timeout: number,
  ): Promise<string> => {
    for (let end = Date.now() + timeout;;) {
      let row = (await one(ctx.graph, session))!
      let entries = await entriesOf(ctx, session)
      if (over(row, entries)) return ending(ctx, row, entries)
      if (Date.now() >= end) {
        return `${human(ctx.graph.vocab)(row)} — ${
          statusOf(entries)
        }, still running after ${Math.round(timeout / 1000)}s`
      }
      await sleep(Math.min(beat, Math.max(0, end - Date.now())))
    }
  }

  return {
    session_spawn: async (_bundles, ctx): Promise<Bundle[]> => {
      let [task, provider, model] = await addressed(ctx.graph, [
        str(ctx.args.task),
        str(ctx.args.provider),
        str(ctx.args.model),
      ])
      // By eid, never by position: a read answers with what it FOUND, so an
      // id that is not there would otherwise shift its neighbour into its
      // place and refuse the wrong word.
      let found = new Map(
        (await ctx.graph.storage.tx((tx) =>
          tx.get([task, provider, model].filter(Boolean))
        )).map((b) => [b.entity.eid, b]),
      )
      let [on, serves, served] = [task, provider, model].map((e) =>
        found.get(e)
      )
      if (!on) throw new Error(`no such task: ${str(ctx.args.task)}`)
      if (!comp(serves, 'provider')?.name) {
        throw new Error(`not a provider: ${str(ctx.args.provider)}`)
      }
      if (model && !served?.model) {
        throw new Error(`not a model: ${str(ctx.args.model)}`)
      }
      let effort = str(ctx.args.effort)
      let session = uuid()
      // The instruction says which work it is, and no more: the session holds
      // the claim, and every session here opens by reading what it holds.
      let instruction = str(ctx.args.instruction) ||
        [human(ctx.graph.vocab)(on), str(comp(on, 'doc')?.title)]
          .filter(Boolean).join(' — ')
      // The request, and the lease that says who is doing it. The lease is
      // guarded, so handing an agent work somebody else holds refuses the
      // whole batch rather than starting a second one on it.
      await ctx.graph.apply(
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
        ], ctx.actor),
      )
      let row = (await one(ctx.graph, session))!
      let name = human(ctx.graph.vocab)(row)
      return [said(
        ctx,
        ctx.args.wait
          ? await watched(ctx, session, patience(ctx.args.timeout))
          : `${name} spawned`,
      )]
    },

    session_wait: async (_bundles, ctx): Promise<Bundle[]> => {
      let row = await sessionAt(ctx)
      return [said(
        ctx,
        await watched(ctx, row.entity.eid, patience(ctx.args.timeout)),
      )]
    },

    session_peek: async (_bundles, ctx): Promise<Bundle[]> => {
      let row = await sessionAt(ctx)
      let entries = await entriesOf(ctx, row.entity.eid)
      let shown = entries.slice(-lines(ctx.args.lines))
      return [said(
        ctx,
        [
          `${human(ctx.graph.vocab)(row)} — ${statusOf(entries)}`,
          ...shown.map((b) =>
            render(views, b, 'Line', ctx.graph.vocab, {}, 'plain').trim()
          ),
        ].join('\n'),
      )]
    },
  }
}
