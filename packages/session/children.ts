import { derivedEid } from '@yaks/graph/identity'
import { appendEntry } from './append.ts'
import { workedOn } from './lease.ts'
// Delegation is transcript structure, not a process handle. A spawned session
// names its parent and originating call; a fork additionally names a prefix.
// Submission is serialized per graph (across parents and tool tables). The
// durable queue order and fork prefix commit with the child. Replays find
// that same child; preparation is deferred until the runner admits it
// (./run.ts).
import { aside, dispatchStatus, tail } from './admission.ts'
import type { Bundle, Comp, Eid, Graph } from '@yaks/graph'
import { identityEid } from '@yaks/graph/identity'
import { link } from '@yaks/edge'
import { human, parse } from '@yaks/id'
import { done, statusComps, statusOf as taskStatus } from '@yaks/task'
import {
  type Tool,
  type ToolContext,
  ToolError,
  transcript,
  wordsOf,
} from './react.ts'
import { entryStatus, newestOf, openOf, usingOf } from './reach.ts'
import { live, newestAsk, textOf, usingBefore } from './state.ts'
import { type Clock, system } from '@yaks/fp'
import { changes } from './wait.ts'
import { childNotice } from './child-notice.ts'

export type ChildLimits = {
  /** Defaults for user-created tasks, resolved before durable queue admission. */
  taskDefaults?: (parent: Eid, child: Eid) => Promise<Record<string, unknown>>
  maxChildren?: number
  maxSessions?: number
  /** Application-owned optional spawn parameters and preparation, applied when
   * the child is admitted. */
  childProperties?: Record<string, unknown>
  prepareChild?: (
    input: { parent: Eid; child: Eid; args: Record<string, unknown> },
  ) => Promise<Omit<Bundle, 'entity'>>
  /** The clock a wait keeps time by (default the system's). */
  clock?: Clock
}
let locks = new WeakMap<Graph, Promise<unknown>>()
let comp = (b: Bundle | undefined, name: string) =>
  b?.[name] as Comp | undefined
let row = async (g: Graph, eid: Eid, comps?: string[]) =>
  (await g.get([eid], comps))[0]

// Waiting needs only the child's place, not its computed transcript status/cost.
export let childPlace = async (
  g: Graph,
  eid: Eid,
): Promise<Bundle | undefined> =>
  (await g.get(
    [eid],
    ['dispatch', 'admitted', 'waiting'].filter((name) => g.vocab.comp(name)),
  ))[0]

let taskRow = async (
  g: Graph,
  id: string,
  comps?: string[],
): Promise<Bundle> => {
  let b = await row(g, id, comps)
  if (!b && parse(id)) [b] = await g.read(`.task .entity.eid=${id} *`)
  if (!b?.task) throw new ToolError('task', `not a task: ${id}`)
  return b
}

/** Direct children, including forks created by the session tools. */
export let children = (g: Graph, session: Eid): Promise<Bundle[]> =>
  Promise.resolve(g.read(`.spawned.parent=${session}&*`))

// How many sessions the cap counts: their number, never their rows.
let running = async (g: Graph): Promise<number> =>
  Number((await g.rows(`${live} .count`))[0]?.n ?? 0)

/** The admission path the harness calls, shared by root starts and delegated
 * starts. */
export let admit = <T>(
  g: Graph,
  parent: Eid | undefined,
  limits: ChildLimits,
  create: () => Promise<T>,
): Promise<T> => {
  let go = (locks.get(g) ?? Promise.resolve()).catch(() => {}).then(
    async () => {
      let maxChildren = limits.maxChildren ?? 32
      let maxSessions = limits.maxSessions ?? 64
      for (let n of [maxChildren, maxSessions]) {
        if (!Number.isInteger(n) || n < 0) {
          throw new Error('invalid session cap')
        }
      }
      if (!parent && await running(g) >= maxSessions) {
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

// The name a child was given (`title`), as its own `doc{title}`, which
// names it wherever a session is named (./name.ts `sessionName`).
let named = (g: Graph, title: unknown) =>
  typeof title == 'string' && title.trim() && g.vocab.comp('doc')
    ? { doc: { title: title.trim().replace(/\s+/g, ' ') } }
    : {}

/** One admission/write path for model delegation and user-created tasks. */
let delegation = (
  g: Graph,
  limits: ChildLimits,
  fork: boolean,
  minted?: Bundle,
  submitted = false,
): Tool => ({
  name: fork ? 'fork' : 'spawn',
  step: { doing: 'Starting a helper…', done: 'Started a helper' },
  description: fork
    ? 'Fork your transcript before this tool turn with a prompt OR atomically claimed task (original title/body). Returns the concurrent child session id; completion is delivered automatically.'
    : 'Start a fresh subagent with a prompt OR a task id. A task is claimed atomically and its title/body become the input. Returns a child ID immediately; a shared worker pool queues excess work durably and delivers completion automatically.',
  parameters: {
    type: 'object',
    properties: {
      ...limits.childProperties,
      prompt: { type: 'string' },
      title: {
        type: 'string',
        description:
          'A short name for the job, 3 to 6 words, as a person would name it. Lists of helpers show it.',
      },
      task: { type: 'string', description: 'task entity id or T-id' },
      instructions: { type: 'string' },
      model: {
        type: 'string',
        description: 'model name or existing model entity id',
      },
      effort: { type: 'string' },
    },
  },
  run: async (args, context) => {
    let ctx = caller(context)
    if (
      (args.task != null) == (args.prompt != null)
    ) {
      throw new ToolError(
        'spawn',
        'name exactly one prompt or task',
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
    let eid = derivedEid(`child:${ctx.call.entity.eid}`)
    if (await row(g, eid)) return eid
    // A fork is offered its parent's tools, so its cached prefix is the
    // parent's, fork among them; one that forked again forked its task down
    // a chain, each level saying it was on it (T-145495). Its answer is to do
    // the task itself.
    if (fork && !minted && (await row(g, ctx.session))?.fork) {
      throw new ToolError(
        'fork',
        'You are a fork already: do this task here yourself, and give your report as your final reply.',
      )
    }
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
      let prompt = minted
        ? doc?.body || doc?.title || ''
        : task
        ? [doc?.title, doc?.body].filter(Boolean).join('\n\n')
        : args.prompt
      if (minted && limits.taskDefaults) {
        args = { ...await limits.taskDefaults(ctx.session, eid), ...args }
      }
      if (minted) ctx = { ...ctx, entries: await transcript(g, ctx.session) }
      let using = { ...usingBefore(ctx.entries) }
      let models: Bundle[] = []
      if (args.model != null) {
        // A model is named by its id or by its own name. The provider in force
        // stays only while it serves the model; otherwise the resolver picks
        // one of the model's providers. A name nothing knows yet becomes a
        // requested model (@yaks/model `requesting`): the provider in force is
        // asked for it, and only its answer records that it serves it. Until
        // then nobody serves it, so a helper started meanwhile asks the
        // provider in force too.
        let said = String(args.model)
        let known = await row(g, said)
        let model = known?.model ? said : identityEid('model', [said])
        using.model = model
        let held = known?.model ? known : await row(g, model)
        if (held && !held.pending) {
          let offers = await g.read(`.serves .edge.to=${model}`)
          if (!offers.some((o) => comp(o, 'edge')?.from == using.provider)) {
            delete using.provider
          }
        } else if (!held) {
          models.push({
            entity: { eid: model },
            model: { name: said, offered: false },
            pending: {},
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
      if (minted) {
        // User tasks reference a contiguous parent prefix. Only an active
        // attempt can still change it; terminal attempts must not pin future
        // forks to an old boundary. Inputs after this boundary remain in the
        // parent, rather than being copied into the child.
        let active = ctx.entries.findIndex((b) =>
          (b.attempt as Comp | undefined)?.state == 'inflight'
        )
        anchor = active == 0
          ? undefined
          : ctx.entries.at(active < 0 ? -1 : active - 1)
      }
      if (fork && !anchor && !minted) {
        throw new ToolError('fork', 'no prefix to fork')
      }
      if (
        fork && anchor &&
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
          entity: { eid: derivedEid(eid + ':shared:' + i) },
          content: { body: textOf(b) },
          prompt: { ...(b.prompt as Comp) },
        }))
      if (fork) {
        context.push({
          entity: { eid: derivedEid(eid + ':fork-context') },
          prompt: { scope: 'local', source: 'harness:fork' },
          content: {
            body:
              'You are a fork of the conversation above, started for the task below. Do it here yourself: you already hold all of its context, so forking it again only repeats you. Start a fresh subagent only for a separate part that needs a clean start. Your final reply is your report to the parent and ends your work, so give it when the task is done, not before.',
          },
        })
      }
      if (args.instructions != null) {
        context.push({
          entity: { eid: derivedEid(eid + ':guidance') },
          prompt: { scope: 'local', source: 'delegation:instructions' },
          content: { body: String(args.instructions) },
        })
      }
      context = context.map((b) => ({
        ...b,
        entry: {
          session: eid,
          ...comp(b, 'prompt')?.source == 'delegation:instructions'
            ? { from: 'your parent session' }
            : {},
        },
      }))
      let order = await tail(g)
      await g.apply([
        ...minted
          ? [{
            entity: { eid: derivedEid('notice:' + eid) },
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
          native: {},
          spawned: {
            parent: ctx.session,
            ...comp(await row(g, ctx.session, ['spawned']), 'spawned')?.notice
              ? { notice: true }
              : {},
            ...minted || submitted ? {} : { call: ctx.call.entity.eid },
          },
          ...fork && anchor ? { fork: { from: anchor.entity.eid } } : {},
          ...named(g, args.title),
        },
        {
          entity: { eid: derivedEid(`${eid}:input`) },
          entry: { session: eid, from: 'your parent session' },
          content: { body: prompt },
          using,
        },
      ], { trusted: true })
      return eid
    })
  },
})

/** Submit helper work from an outside caller, without inventing a model tool
 * call in the parent's transcript. It shares the model's admission path. */
export let spawnChild = async (
  g: Graph,
  session: Eid,
  args: Record<string, unknown>,
  limits: ChildLimits = {},
  source: Eid = crypto.randomUUID(),
): Promise<Eid> =>
  wordsOf(
    await delegation(g, limits, false, undefined, true).run(args, {
      session,
      call: { entity: { eid: source } },
      entries: await transcript(g, session),
    }),
  )

/** Submit a microtask under the session's claimed work (or the session when
 * it holds no task). The task, containment, child and claim commit together:
 * queued work is accepted without preparing a checkout. No filing metadata is inherited.
 * The first line is the title; the complete submitted text is kept as body.
 * This is called by a person, not by a model, so delivery is an ordinary
 * input. */
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
  let child = await delegation(g, limits, true, minted).run({ task }, {
    session,
    // Identity only; no fabricated tool call is written into the transcript.
    call: { entity: { eid: task } },
    entries: await transcript(g, session),
  })
  return { task, child: wordsOf(child) }
}

/** The model-facing tools use the same admission and spawn write as
 * taskEntry. */
export let sessionTools = (g: Graph, limits: ChildLimits = {}): Tool[] => {
  return [delegation(g, limits, true), delegation(g, limits, false), {
    name: 'notice',
    description:
      'Append your words as passive context to a session without waking it, identified as coming from your session. Sequence is assigned atomically; do not guess entry.seq.',
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
      let ctx = caller(context)
      let session = String(args.session)
      if (!(await row(g, session))?.session) {
        throw new ToolError('session', 'not a session: ' + session)
      }
      let added = await appendEntry(g, session, String(args.body), {
        notice: true,
        from: `session ${ctx.session}`,
        eid: args.eid == null ? undefined : String(args.eid),
      })
      return added[0].entity.eid
    },
  }, {
    name: 'wait',
    waits: true,
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
      // Each look reads only what decides the answer: a task's status marks,
      // a child's place and transcript status. A child's output is read once,
      // for the answer.
      let marks = statusComps(g.vocab)
      if (args.tasks != null) {
        ids = await Promise.all(
          ids.map(async (id) => (await taskRow(g, id, marks)).entity.eid),
        )
      }
      for (let id of args.tasks == null ? ids : []) {
        if (
          comp(await row(g, id, ['spawned']), 'spawned')?.parent != ctx.session
        ) {
          throw new ToolError('children', `not your child: ${id}`)
        }
      }
      let ms = Number(args.timeout ?? 60_000)
      if (!Number.isFinite(ms) || ms < 0) {
        throw new ToolError('timeout', 'invalid timeout')
      }
      let clock = limits.clock ?? system
      let end = clock.now() + ms
      let back = await aside(g, ctx.session, limits, ctx.signal)
      let task = async (id: Eid) => ({
        task: id,
        status: taskStatus(g.vocab, await taskRow(g, id, marks)),
        done: await done(g, id),
      })
      let child = async (session: Eid) => {
        let state = dispatchStatus(await childPlace(g, session))
        let now = await entryStatus(g, session)
        return state == 'queued' && now != 'stopped' ? 'queued' : now
      }
      let ended = (status: string) =>
        ['settled', 'failed', 'stopped'].includes(status)
      try {
        for await (
          let over of changes(g, {
            timeout: end - clock.now(),
            signal: ctx.signal,
            clock,
          })
        ) {
          if (ctx.signal?.aborted) return JSON.stringify({ stopped: true })
          if (args.tasks != null) {
            let results = await Promise.all(ids.map(task))
            if (results.every((r) => r.done) || over) {
              return JSON.stringify(results)
            }
          } else {
            let states = await Promise.all(ids.map(child))
            if (states.every(ended) || over) {
              return JSON.stringify(
                await Promise.all(ids.map(async (session, n) => {
                  let last = await newestOf(g, session)
                  return {
                    session,
                    status: states[n],
                    output: last ? textOf(last) : '',
                  }
                })),
              )
            }
          }
        }
        throw new Error('wait ended without a final read')
      } finally {
        await back()
      }
    },
  }]
}

// Whether any of a session's helpers, at any depth, has yet to end and be
// told. A child's dispatch settles after its report is written, or held for
// helpers of its own (./run.ts), so a settled child still works while one of
// its own does.
let working = async (g: Graph, session: Eid): Promise<boolean> => {
  for (let c of await children(g, session)) {
    let place = dispatchStatus(c)
    if (place != null && place != 'settled') return true
    let status = await entryStatus(g, c.entity.eid)
    if (!['settled', 'failed', 'stopped'].includes(status)) return true
    if (status == 'settled' && await working(g, c.entity.eid)) return true
  }
  return false
}

/** Build one idempotent completion receipt, while holding the parent's queue.
 * The final-entry-derived id also allows a child to be sent another turn. */
export let deliverChild = async (
  g: Graph,
  child: Eid,
  now: number = Date.now(),
): Promise<number | undefined> => {
  let link = comp(await row(g, child), 'spawned')
  if (!link?.parent || !await row(g, String(link.parent))) return
  if (link.notice) {
    return childNotice(g, child, link, now, () => working(g, child))
  }
  // A settled child's receipt usually already exists. Inspect its local tail
  // before materializing the inherited prefix (which can be very large).
  let [tail] = await g.read(
    '.entry.session=' + child + '&.order=-entry.seq&.limit=1&*',
  )
  // The task it was given, which lets go of the child's claim once done.
  let tasks = g.vocab.comps.includes('task')
    ? await g.get(await workedOn(g, child))
    : []
  let task = tasks.find((b) => b?.task)
  let ready = task &&
    await done(g, task.entity.eid)
  let last = tail ?? await newestOf(g, child)
  if (!last) return
  // A parent's own completion is already known to it: the completion came
  // through it (`via`; `by` is the actor it works for). Fall back to the
  // ordinary child receipt identity: a new child response must still arrive,
  // while an already delivered response must not echo on completion/restart.
  let announceTask = ready &&
    (taskStatus(g.vocab, task!) != 'done' ||
      comp(task, 'completed')?.via != String(link.parent))
  let receipt = (last: Bundle) =>
    derivedEid(
      announceTask
        ? `delivery:${child}:task:${task!.entity.eid}:${
          taskStatus(g.vocab, task!)
        }`
        : `delivery:${child}:${last.entity.eid}`,
    )
  let eid = receipt(last)
  if (await row(g, eid)) return
  let status = await entryStatus(g, child)
  // A new receipt still requires the full transcript's terminal outcome.
  if (!['settled', 'failed', 'stopped'].includes(status)) return
  // A child whose own helpers still work has not answered yet: their reports
  // will wake it, and one call reports once, after they end.
  if (status == 'settled' && await working(g, child)) return
  // The model may have finished while the fast-path reads were awaiting.
  // Use the same terminal snapshot for the receipt identity and its text.
  last = (await newestOf(g, child))!
  eid = receipt(last)
  if (await row(g, eid)) return
  let message = announceTask
    ? `task ${
      task!.entity.num != null ? human(g.vocab)(task!) : task!.entity.eid
    } ${taskStatus(g.vocab, task!)}`
    : `child ${child} ${status}`
  let notice = await row(g, derivedEid('notice:' + child))
  let context = notice?.notice
    ? textOf(notice) + '\nOutcome: child ' + status +
      (ready ? '; task ' + taskStatus(g.vocab, task!) : '') + '\nResult:\n'
    : ''
  let parent = String(link.parent)
  // A stop is an explicit end, not a request to wake on the next delivery.
  if (await entryStatus(g, parent) == 'stopped') return
  let open = (await openOf(g, parent)).some((b) => b.entity.eid == link.call)
  // The parent's `using` in force rides on the receipt: it is the request for
  // the turn the receipt calls for (./run.ts).
  let using = await usingOf(g, parent)
  await g.apply([{
    entity: { eid },
    entry: {
      session: parent,
    },
    content: { body: message + '\n' + context + textOf(last) },
    delivery: { child, outcome: status },
    ...open ? { result: { call: link.call } } : {},
    ...using ? { using } : {},
  }], { trusted: true })
}
