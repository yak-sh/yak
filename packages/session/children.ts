import { appendEntry } from './append.ts'
import { configurePool, pool } from './pool.ts'
// Delegation is transcript structure, not a process handle. A spawned session
// names its parent and originating call; a fork additionally names a prefix.
// Submission is serialized per graph (across parents and tool tables). The
// durable queue order and fork prefix commit with the child. Replays find
// that same child; preparation is deferred until a daemon admits it.
import type { Bundle, Comp, Eid, Graph } from '@yaks/graph'
import { link } from '@yaks/edge'
import { done, MARKS, statusOf as taskStatus } from '@yaks/task'
import { type Tool, type ToolContext, ToolError, transcript } from './react.ts'
import {
  newestAsk,
  openCalls,
  statusOf,
  textOf,
  usingBefore,
} from './status.ts'

export type ChildLimits = {
  maxChildren?: number
  maxSessions?: number
  /** Host-owned optional spawn parameters and preparation, when the child is admitted. */
  childProperties?: Record<string, unknown>
  prepareChild?: (
    input: { parent: Eid; child: Eid; args: Record<string, unknown> },
  ) => Promise<Omit<Bundle, 'entity'>>
}
let locks = new WeakMap<Graph, Promise<unknown>>()
let comp = (b: Bundle | undefined, name: string) =>
  b?.[name] as Comp | undefined
let row = async (g: Graph, eid: Eid) =>
  (await g.storage.tx((tx) => tx.get([eid])))[0]

/** The lease rung for a task held by a session; terminal task marks win. */
export let taskMarks = [...MARKS, {
  status: 'wip',
  comp: 'claim',
  settled: false,
}]

let taskRow = async (g: Graph, id: string): Promise<Bundle> => {
  let b = await row(g, id)
  let num = /^T-(\d+)$/i.exec(id)?.[1]
  if (!b && num) [b] = await g.read(`.task .num=${Number(num)}`)
  if (!b?.task) throw new ToolError('task', `not a task: ${id}`)
  return b
}

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
  configurePool(g, limits)
  let go = (locks.get(g) ?? Promise.resolve()).catch(() => {}).then(
    async () => {
      let maxChildren = limits.maxChildren ?? 32
      let maxSessions = limits.maxSessions ?? 64
      for (let n of [maxChildren, maxSessions]) {
        if (!Number.isInteger(n) || n < 0) {
          throw new Error('invalid session cap')
        }
      }
      if (
        !parent &&
        (await g.read('.session .session.status=empty,pending,running'))
            .length >= maxSessions
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

/** One admission/write path for model delegation and user-created tasks. */
let delegation = (
  g: Graph,
  limits: ChildLimits,
  fork: boolean,
  minted?: Bundle,
): Tool => ({
  name: fork ? 'fork' : 'spawn',
  description: fork
    ? 'Fork your transcript before this tool turn, with a new prompt. Returns the concurrent child session id; completion is delivered automatically.'
    : 'Start a fresh subagent with a prompt OR a task id. A task is claimed atomically and its title/body become the input. Returns a child ID immediately; a shared worker pool queues excess work durably and delivers completion automatically.',
  parameters: {
    type: 'object',
    properties: {
      ...limits.childProperties,
      prompt: { type: 'string' },
      ...fork
        ? {}
        : { task: { type: 'string', description: 'task entity id or T-id' } },
      instructions: { type: 'string' },
      model: {
        type: 'string',
        description: 'model name or existing model entity id',
      },
      effort: { type: 'string' },
    },
    ...fork ? { required: ['prompt'] } : {
      oneOf: [{ required: ['prompt'] }, { required: ['task'] }],
    },
  },
  run: async (args, context) => {
    let ctx = caller(context)
    if (
      fork ? args.task != null : (args.task != null) == (args.prompt != null)
    ) {
      throw new ToolError(
        'spawn',
        'name exactly one prompt or task (fork requires prompt)',
      )
    }
    if (
      args.task != null && (typeof args.task != 'string' || !args.task.trim())
    ) {
      throw new ToolError('task', 'a nonempty task id is required')
    }
    if (
      args.task == null &&
      (typeof args.prompt != 'string' || !args.prompt.trim())
    ) {
      throw new ToolError('prompt', 'a nonempty prompt is required')
    }
    let eid = `child:${ctx.call.entity.eid}`
    if (await row(g, eid)) return eid
    return admit(g, ctx.session, limits, async () => {
      // A concurrent replay may have waited behind the original admission.
      if (await row(g, eid)) return eid
      let task = minted ??
        (args.task == null ? undefined : await taskRow(g, String(args.task)))
      let work = minted
        ? await g.read(`.task .claim.session=${ctx.session}`)
        : []
      let parents = work.length ? work.map((b) => b.entity.eid) : [ctx.session]
      let doc = comp(task, 'doc')
      let prompt = task
        ? [doc?.title, doc?.body].filter(Boolean).join('\n\n')
        : args.prompt
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
      // Legacy base instructions are inherited; child guidance is additive.
      for (let key of ['effort']) {
        if (args[key] != null) using[key] = String(args[key])
      }
      // Never inherit the unanswered delegation call (or any sibling calls).
      let anchorId = comp(newestAsk(ctx.entries), 'ask')?.through
      let anchor = ctx.entries.find((b) => b.entity.eid == anchorId)
      if (fork && !anchor) throw new ToolError('fork', 'no prefix to fork')
      if (
        fork &&
        ctx.entries.some((b) =>
          (b.attempt as Comp | undefined)?.state == 'inflight' &&
          Number((b.entry as Comp)?.seq) <= Number((anchor!.entry as Comp)?.seq)
        )
      ) {
        throw new ToolError(
          'fork',
          'Cannot inherit an in-flight response; wait for its completion',
        )
      }

      // Fork history is immutable. Fresh children receive the same shared
      // snapshots, never a filesystem reread or a replacement persona.
      let context: Bundle[] = fork
        ? []
        : ctx.entries.filter((b) =>
          (b.prompt as Comp | undefined)?.scope == 'shared'
        ).map((b, i) => ({
          entity: { eid: eid + ':shared:' + i },
          content: { body: textOf(b) },
          prompt: { ...(b.prompt as Comp) },
        }))
      if (fork) {
        context.push({
          entity: { eid: eid + ':fork-context' },
          prompt: { scope: 'local', source: 'harness:fork' },
          content: {
            body:
              'You are executing an assignment in a fork of the parent transcript. Perform the assigned work here. Do not reflexively delegate it because the inherited parent conversation discusses delegation.',
          },
        })
      }
      if (args.instructions != null) {
        context.push({
          entity: { eid: eid + ':guidance' },
          prompt: { scope: 'local', source: 'delegation:instructions' },
          content: { body: String(args.instructions) },
        })
      }
      context = context.map((b) => ({
        ...b,
        entry: { session: eid },
      }))
      let order = Math.max(
        0,
        ...(await g.read('.dispatch')).map((b) =>
          Number((b.dispatch as Comp).order ?? 0)
        ),
      ) + 1
      await g.apply([
        ...minted
          ? [{
            entity: { eid: 'notice:' + eid },
            entry: {
              session: ctx.session,
            },
            notice: { child: eid, task: minted.entity.eid },
            content: {
              body: [
                'Task: ' + String(doc?.title ?? ''),
                'Origin: user-created task, automatically delegated to child ' +
                eid,
                'Request:',
                String(doc?.body ?? ''),
              ].join('\n'),
            },
          }]
          : [],
        ...models,
        ...context,
        ...minted
          ? [
            minted,
            ...parents.map((parent) =>
              link(parent, 'contains', minted.entity.eid)
            ),
          ]
          : [],
        ...task ? [{ entity: task.entity, claim: { session: eid } }] : [],
        {
          entity: { eid },
          dispatch: { state: 'queued', args: JSON.stringify(args), order },
          session: { id: eid },
          spawned: {
            parent: ctx.session,
            ...minted ? {} : { call: ctx.call.entity.eid },
          },
          ...fork ? { fork: { from: anchor!.entity.eid } } : {},
        },
        {
          entity: { eid: `${eid}:input` },
          entry: { session: eid },
          content: { body: prompt },
          using,
        },
      ], { trusted: true })
      return eid
    })
  },
})

/** Submit a microtask under the session's claimed work (or the session when
 * it holds no task). The task, containment, child and claim commit together:
 * queued work is accepted without preparing a checkout. No filing metadata is inherited.
 * The first line is the title; the complete submitted text is kept as body.
 * This is a user door, not a model call, so delivery is an ordinary input. */
export let taskEntry = async (
  g: Graph,
  session: Eid,
  text: string,
  limits: ChildLimits = {},
): Promise<{ task: Eid; child: Eid }> => {
  if (!text.trim()) throw new ToolError('task', 'a nonempty task is required')
  if (!(await row(g, session))?.session) {
    throw new ToolError('session', `not a session: ${session}`)
  }
  let task = crypto.randomUUID()
  let minted: Bundle = {
    entity: { eid: task },
    doc: { title: text.trim().split('\n')[0].slice(0, 120), body: text },
    task: {},
  }
  let child = await delegation(g, limits, false, minted).run({ task }, {
    session,
    // Identity only; no fabricated tool call is written into the transcript.
    call: { entity: { eid: task } },
    entries: await transcript(g, session),
  })
  return { task, child: String(child) }
}

/** The model doors use the same admission and spawn write as taskEntry. */
export let sessionTools = (g: Graph, limits: ChildLimits = {}): Tool[] => {
  configurePool(g, limits)
  return [delegation(g, limits, true), delegation(g, limits, false), {
    name: 'notice',
    description:
      'Append passive context to a session without waking it. Sequence is assigned atomically; do not guess entry.seq.',
    parameters: {
      type: 'object',
      properties: {
        session: { type: 'string' },
        body: { type: 'string' },
        eid: {
          type: 'string',
          description: 'optional idempotent entry identity',
        },
      },
      required: ['session', 'body'],
    },
    run: async (args, context) => {
      caller(context)
      let session = String(args.session)
      if (!(await row(g, session))?.session) {
        throw new ToolError('session', 'not a session: ' + session)
      }
      let added = await appendEntry(g, session, String(args.body), {
        notice: true,
        eid: args.eid == null ? undefined : String(args.eid),
      })
      return added[0].entity.eid
    },
  }, {
    name: 'wait',
    description:
      'Wait on direct children or tasks. Tasks wait until settled with no open dependencies; returns status when complete or the timeout passes.',
    parameters: {
      type: 'object',
      properties: {
        children: { type: 'array', items: { type: 'string' }, minItems: 1 },
        tasks: { type: 'array', items: { type: 'string' }, minItems: 1 },
        timeout: {
          type: 'number',
          description: 'milliseconds (default 60000)',
        },
      },
      oneOf: [{ required: ['children'] }, { required: ['tasks'] }],
    },
    run: async (args, context) => {
      let ctx = caller(context)
      if ((args.tasks == null) == (args.children == null)) {
        throw new ToolError('wait', 'name either tasks or child sessions')
      }
      let named = args.tasks ?? args.children
      if (
        !Array.isArray(named) || !named.length ||
        named.some((s) => typeof s != 'string')
      ) {
        throw new ToolError('wait', 'name at least one task or child session')
      }
      let ids = [...new Set(named as string[])]
      if (args.tasks != null) {
        ids = await Promise.all(
          ids.map(async (id) => (await taskRow(g, id)).entity.eid),
        )
      }
      for (let id of args.tasks == null ? ids : []) {
        if (comp(await row(g, id), 'spawned')?.parent != ctx.session) {
          throw new ToolError('children', `not your child: ${id}`)
        }
      }
      let ms = Number(args.timeout ?? 60_000)
      if (!Number.isFinite(ms) || ms < 0) {
        throw new ToolError('timeout', 'invalid timeout')
      }
      let end = Date.now() + ms
      pool(g).suspended.add(ctx.session)
      pool(g).changed?.()
      try {
        for (;;) {
          if (pool(g).stopping?.()) return JSON.stringify({ stopped: true })
          if (args.tasks != null) {
            let results = await Promise.all(ids.map(async (id) => {
              let b = await taskRow(g, id)
              return {
                task: id,
                status: taskStatus(b, taskMarks),
                done: await done(g.storage, id, { marks: taskMarks }),
              }
            }))
            if (results.every((r) => r.done) || Date.now() >= end) {
              return JSON.stringify(results)
            }
          } else {
            let results = await Promise.all(ids.map(async (session) => {
              let entries = await transcript(g, session)
              let state = comp(await row(g, session), 'dispatch')?.state
              let status = state == 'queued' && statusOf(entries) != 'stopped'
                ? 'queued'
                : statusOf(entries)
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
          }
          await new Promise((go) =>
            setTimeout(go, Math.min(25, end - Date.now()))
          )
        }
      } finally {
        await pool(g).resume?.(ctx.session)
        pool(g).suspended.delete(ctx.session)
        pool(g).changed?.()
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
  // Do not consume the receipt id on an intermediate tool turn: the final
  // message is known only once the child has stopped asking for work. A later
  // dependency change still triggers this path after the child is quiet.
  if (!['settled', 'failed', 'stopped'].includes(status)) return
  let tasks = g.vocab.comps.includes('task')
    ? await g.read(`.task .claim.session=${child}`)
    : []
  let task = tasks.find((b) => b.task)
  let ready = task &&
    await done(g.storage, task.entity.eid, { marks: taskMarks })
  let last = entries.at(-1)
  if (!last) return
  // A parent's own completion is already known to it. Fall back to the
  // ordinary child receipt identity: a new child response must still arrive,
  // while an already delivered response must not echo on completion/restart.
  let announceTask = ready &&
    (taskStatus(task!, taskMarks) != 'done' ||
      comp(task, 'completed')?.by != String(link.parent))
  let eid = announceTask
    ? `delivery:${child}:task:${task!.entity.eid}:${
      taskStatus(task!, taskMarks)
    }`
    : `delivery:${child}:${last.entity.eid}`
  let message = announceTask
    ? `task ${
      task!.entity.num != null ? `T-${task!.entity.num}` : task!.entity.eid
    } ${taskStatus(task!, taskMarks)}`
    : `child ${child} ${status}`
  if (await row(g, eid)) return
  let notice = await row(g, 'notice:' + child)
  let context = notice?.notice
    ? textOf(notice) + '\nOutcome: child ' + status +
      (ready ? '; task ' + taskStatus(task!, taskMarks) : '') + '\nResult:\n'
    : ''
  let parent = String(link.parent)
  let prefix = await transcript(g, parent)
  // A stop is an explicit end, not a request to wake on the next delivery.
  if (statusOf(prefix) == 'stopped') return
  let open = openCalls(prefix).some((b) => b.entity.eid == link.call)
  await g.apply([{
    entity: { eid },
    entry: {
      session: parent,
    },
    content: { body: message + '\n' + context + textOf(last) },
    ...open ? { result: { call: link.call } } : {},
  }], { trusted: true })
}
