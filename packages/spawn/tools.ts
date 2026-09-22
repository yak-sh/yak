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

// A tool's text answer, as a row: its own entity, recording which call it came
// from. Every tool here answers in this shape.
let said = (ctx: ToolCtx, body: string): Bundle => ({
  entity: { eid: uuid() },
  content: { body },
  [OUTPUT]: { source: ctx.call },
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
      // Match by eid, never by position: a read returns only the rows it
      // found, so a missing id would otherwise shift its neighbour into its
      // place and the error would name the wrong argument.
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
      if (model && await spelling(ctx.graph, provider, model) == null) {
        throw new Error(
          `${str(ctx.args.provider)} does not serve ${str(ctx.args.model)}`,
        )
      }
      let effort = str(ctx.args.effort)
      let session = uuid()
      // The instruction names the work and no more: the session holds the
      // claim, and every session here starts by reading what it holds.
      let instruction = str(ctx.args.instruction) ||
        [human(ctx.graph.vocab)(on), str(comp(on, 'doc')?.title)]
          .filter(Boolean).join(' — ')
      // The request, plus the lease recording who is doing the work. The
      // lease is guarded, so handing an agent work somebody else already holds
      // rejects the whole transaction rather than starting a second run on
      // it.
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
