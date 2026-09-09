// Delegation is transcript structure, not a process handle. A spawned session
// names its parent and originating call; a fork additionally names a prefix.
// Admission is serialized per graph (across parents and tool tables), with the
// counts read from the graph inside that critical section. No reserved slots
// survive a failed write, and replaying a call finds the same child.
import type { Bundle, Comp, Eid, Graph } from '@yaks/graph'
import { type Tool, type ToolContext, ToolError, transcript } from './react.ts'
import {
  newestAsk,
  openCalls,
  seqOf,
  statusOf,
  textOf,
  usingBefore,
} from './status.ts'

export type ChildLimits = { maxChildren?: number; maxSessions?: number }
let locks = new WeakMap<Graph, Promise<unknown>>()
let comp = (b: Bundle | undefined, name: string) =>
  b?.[name] as Comp | undefined
let row = async (g: Graph, eid: Eid) =>
  (await g.storage.tx((tx) => tx.get([eid])))[0]
let live = 'empty,pending,running'

/** Direct children, including forks created by the session tools. */
export let children = (g: Graph, session: Eid): Promise<Bundle[]> =>
  Promise.resolve(g.read(`.spawned.parent=${session}`))

/** The harness's admission door, shared by root starts and delegated starts. */
export let admit = <T>(
  g: Graph,
  parent: Eid | undefined,
  limits: ChildLimits,
  create: () => Promise<T>,
): Promise<T> => {
  let go = (locks.get(g) ?? Promise.resolve()).catch(() => {}).then(
    async () => {
      let maxChildren = limits.maxChildren ?? 4
      let maxSessions = limits.maxSessions ?? 16
      for (let n of [maxChildren, maxSessions]) {
        if (!Number.isInteger(n) || n < 0) {
          throw new Error('invalid session cap')
        }
      }
      if (
        parent &&
        (await g.read(`.spawned.parent=${parent} .session.status=${live}`))
            .length >= maxChildren
      ) {
        throw new ToolError(
          'child_cap',
          `concurrent child cap (${maxChildren}) reached`,
        )
      }
      if (
        (await g.read(`.session .session.status=${live}`)).length >= maxSessions
      ) {
        throw new ToolError(
          'session_cap',
          `live session cap (${maxSessions}) reached`,
        )
      }
      return await create()
    },
  )
  locks.set(g, go)
  return go
}

let caller = (ctx?: ToolContext): ToolContext => {
  if (!ctx) throw new ToolError('caller', 'session tool requires a caller')
  return ctx
}

/** Fork and spawn return immediately with a child id. Wait has the process
 * tool's timeout convention, but names an array of direct child sessions. */
export let sessionTools = (g: Graph, limits: ChildLimits = {}): Tool[] => {
  let start = (fork: boolean): Tool => ({
    name: fork ? 'fork' : 'spawn',
    description: fork
      ? 'Fork your transcript before this tool turn, with a new prompt. Returns the concurrent child session id; completion is delivered automatically.'
      : 'Start a fresh subagent. Returns the concurrent child session id; completion is delivered automatically.',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string' },
        instructions: { type: 'string' },
        model: {
          type: 'string',
          description: 'model name or existing model entity id',
        },
        effort: { type: 'string' },
      },
      required: ['prompt'],
    },
    run: async (args, context) => {
      let ctx = caller(context)
      if (typeof args.prompt != 'string' || !args.prompt.trim()) {
        throw new ToolError('prompt', 'a nonempty prompt is required')
      }
      let eid = `child:${ctx.call.entity.eid}`
      if (await row(g, eid)) return eid
      return admit(g, ctx.session, limits, async () => {
        let using = { ...usingBefore(ctx.entries) }
        let models: Bundle[] = []
        if (args.model != null) {
          let name = String(args.model)
          let existing = await row(g, name)
          if (existing?.model) using.model = existing.entity.eid
          else {
            using.model = `model:${name}`
            models.push({
              entity: { eid: String(using.model) },
              model: {
                name,
                ...using.provider ? { provider: using.provider } : {},
              },
            })
          }
        }
        for (let key of ['effort', 'instructions']) {
          if (args[key] != null) using[key] = String(args[key])
        }
        // Never inherit the unanswered delegation call (or any sibling calls).
        let anchorId = comp(newestAsk(ctx.entries), 'ask')?.through
        let anchor = ctx.entries.find((b) => b.entity.eid == anchorId)
        if (fork && !anchor) throw new ToolError('fork', 'no prefix to fork')
        await g.apply([
          ...models,
          {
            entity: { eid },
            session: { id: eid },
            spawned: { parent: ctx.session, call: ctx.call.entity.eid },
            ...fork ? { fork: { from: anchor!.entity.eid } } : {},
          },
          {
            entity: { eid: `${eid}:input` },
            entry: { session: eid, seq: fork ? seqOf(anchor!) + 1 : 1 },
            content: { body: args.prompt },
            using,
          },
        ], { trusted: true })
        return eid
      })
    },
  })
  return [start(true), start(false), {
    name: 'wait',
    description:
      'Wait on named direct children. Returns their status and final output, or still-running status when the timeout passes.',
    parameters: {
      type: 'object',
      properties: {
        children: { type: 'array', items: { type: 'string' }, minItems: 1 },
        timeout: {
          type: 'number',
          description: 'milliseconds (default 60000)',
        },
      },
      required: ['children'],
    },
    run: async (args, context) => {
      let ctx = caller(context)
      if (
        !Array.isArray(args.children) || !args.children.length ||
        args.children.some((s) => typeof s != 'string')
      ) {
        throw new ToolError('children', 'name at least one child session')
      }
      let ids = [...new Set(args.children as string[])]
      for (let id of ids) {
        if (comp(await row(g, id), 'spawned')?.parent != ctx.session) {
          throw new ToolError('children', `not your child: ${id}`)
        }
      }
      let ms = Number(args.timeout ?? 60_000)
      if (!Number.isFinite(ms) || ms < 0) {
        throw new ToolError('timeout', 'invalid timeout')
      }
      let end = Date.now() + ms
      for (;;) {
        let results = await Promise.all(ids.map(async (session) => {
          let entries = await transcript(g, session)
          let status = statusOf(entries)
          return {
            session,
            status,
            output: entries.length ? textOf(entries.at(-1)!) : '',
          }
        }))
        if (
          results.every((r) =>
            ['settled', 'failed', 'stopped'].includes(r.status)
          ) || Date.now() >= end
        ) {
          return JSON.stringify(results)
        }
        await new Promise((go) =>
          setTimeout(go, Math.min(25, end - Date.now()))
        )
      }
    },
  }]
}

/** Build one idempotent completion receipt, while holding the parent's queue.
 * The final-entry-derived id also allows a child to be sent another turn. */
export let deliverChild = async (g: Graph, child: Eid): Promise<void> => {
  let link = comp(await row(g, child), 'spawned')
  if (!link?.parent || !await row(g, String(link.parent))) return
  let entries = await transcript(g, child)
  let status = statusOf(entries)
  if (!['settled', 'failed', 'stopped'].includes(status)) return
  let last = entries.at(-1)!
  let eid = `delivery:${child}:${last.entity.eid}`
  if (await row(g, eid)) return
  let parent = String(link.parent)
  let prefix = await transcript(g, parent)
  // A stop is an explicit end, not a request to wake on the next delivery.
  if (statusOf(prefix) == 'stopped') return
  let open = openCalls(prefix).some((b) => b.entity.eid == link.call)
  await g.apply([{
    entity: { eid },
    entry: {
      session: parent,
      seq: (prefix.length ? seqOf(prefix.at(-1)!) : 0) + 1,
    },
    content: { body: `child ${child} ${status}\n${textOf(last)}` },
    ...open ? { result: { call: link.call } } : {},
  }], { trusted: true })
}
