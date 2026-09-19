// The RUNNER: the one thing that turns a `call` into a `result`, and the only
// thing anywhere that calls a tool function.
//
// A tool is a function from BUNDLES to BUNDLES — `(bundles, host) => bundles`
// — and nothing wires it to the `call` and `result` components. What finds the
// work is a declared RULE, in the ordinary query grammar, read out of this
// package's own vocabulary (./vocab.json):
//
//   call_ready    $call .call, results=; +result.call=$call
//   call_waiting  $call .call, .wake, .fired=
//
// The first says what a call with no answer is and what to attach; the second
// says which of those are not due yet, and is INERT in a graph that knows no
// wakes — which is why the scheduled split costs nothing where nothing is
// scheduled. Both name the `effect` phase, so `apply()` never runs them: they
// are asked here, after the commit, because a tool may take a minute and a
// transaction may not.
//
// The result entity is the rule's own emit (@yaks/graph `emitted`), so its id
// is DERIVED from the firing — `call_ready(<the call>)` — and the same call
// names the same result entity in this process, another process, or a year
// later. Answering twice patches one entity instead of making two.
//
// AT MOST ONCE, and how a crash is recovered: `execution{state}` on the call
// is the claim. The runner writes `running` under a `$was` that the column was
// absent, so a second host loses the race rather than running the tool again;
// it writes `done` or `failed` when the answer lands. A call left `running` by
// a process that died has no result, so the same rule still selects it — and
// `reconcile()` at boot re-drives it, claiming over `running` this time. That
// is the whole sweep: one query, the rule's own.
//
// THE ACTOR IS THE CALLER'S. Whoever wrote the call is who the tool's bundles
// are signed as, never the process running them, so authorization is decided
// about the person asking. The runner's own bookkeeping — the result, the
// execution — is the server's and carries no actor at all.

import {
  type Bundle,
  type Change,
  type Comp,
  type Declared,
  type Eid,
  emitted,
  type Entity,
  type Graph,
  type NamedTool,
  namedTool,
  type Plugin,
  reads,
  type Ready,
  ready,
  signed,
  token,
  type Tool,
  type ToolCtx,
} from '@yaks/graph'
import { derivedEid } from '@yaks/graph'
import { rulesIn } from '@yaks/vocab'
import { validateToolInput } from '@yaks/vocab/tools'
import { toolsDoc } from './vocab.ts'

/** A durable claim exists but no answer does. The host must reconcile it —
 * running the tool again could repeat something the world already saw. */
export class UnfinishedCall extends Error {
  constructor(public call: Eid) {
    super('Call execution was started without a recorded result: ' + call)
    this.name = 'UnfinishedCall'
  }
}

/** Expected invocation failures, not programming defects. */
export class CallError extends Error {
  constructor(public code: string, message: string) {
    super(message)
    this.name = 'CallError'
  }
}

/** The rules this package declares, as the vocabulary says them: the call the
 * runner answers, and the one it leaves alone. */
export let RULES: Declared[] = rulesIn(toolsDoc)
  .filter((r) => r.phase == 'effect')

/** The rule that ANSWERS a call — the one whose emit names the result. */
export let READY = 'call_ready'

/** The rule that says a call is not due — a wake that has not fired. */
export let WAITING = 'call_waiting'

/** The entity a tool is called BY name at: derived, so a graph's tool rows are
 * the same rows every time this runner is built. */
export let toolEid = (name: string): Eid => derivedEid(`tool:${name}`)

/** What a runner is built with. */
export type Opts = {
  /** what it can run */
  tools: Tool[]
  /** the graph the TOOLS work on, where that is not the graph the calls are
   * written to (a door whose ledger is its own) */
  host?: Graph
  /** unexpected defects, reported and not thrown (the batch has committed) */
  report?: (err: unknown, call: Bundle) => void
  /** the clock the `ms` is measured with (default: `performance.now`) */
  now?: () => number
}

/** A live runner: the plugin to register, and the three doors a host uses. */
export type Runner = {
  /** register this on the graph the calls are written to */
  plugin: Plugin
  /** the tools it runs, named */
  tools: NamedTool[]
  /** write the `tool` rows the calls point at — once, at startup */
  ensure: () => Promise<Bundle[]>
  /** ask a tool: the call bundles in, the answer's bundles out */
  call: (change: Change) => Promise<Bundle[]>
  /** run one call that is already in the graph */
  run: (call: Eid, opts?: { redrive?: boolean }) => Promise<Bundle[]>
  /** every call the rules select, run — what the effect does per batch, and
   * what a boot pass does with `redrive` for the ones a crash left claimed */
  drive: (opts?: { redrive?: boolean }) => Promise<Bundle[]>
}

// What a tool's bundles say in words: the prose they carry, or the bundles
// themselves. It rides on the result entity as `content{body}` so a model, a
// terminal and a transcript all read the answer the same way.
export let worded = (answer: Bundle[]): string => {
  let said = answer
    .map((b) => (b.content as Comp | undefined)?.body)
    .filter((body): body is string => typeof body == 'string')
  return said.length ? said.join('\n') : JSON.stringify(answer, null, 2)
}

// Who wrote the call, as the graph recorded it. A batch's `$actor` is the
// pipeline's and never a column, so what survives the commit is the stamp the
// provenance rule wrote — which is the point: the caller is a fact about the
// call, not a claim the runner has to be told again.
let who = (call: Bundle): Entity | null => {
  let by = (call.created as Comp | undefined)?.by ?? call.$actor?.by
  return by ? { eid: String(by) } : null
}

/**
 * What a call ANSWERED, as a host renders it: the tool's own bundles, with the
 * runner's bookkeeping left out. The result entity carries a copy of the prose
 * so a transcript reads one line per answer; a host showing the answer itself
 * would otherwise show it twice.
 */
export let answerOf = (landed: Bundle[]): Bundle[] =>
  landed.filter((b) => !b.result && !b.execution)

let parsed = (args: unknown): Record<string, unknown> => {
  let value: unknown
  try {
    value = JSON.parse(String(args ?? '{}'))
  } catch {
    throw new CallError('arguments', 'Invalid JSON tool arguments')
  }
  if (!value || typeof value != 'object' || Array.isArray(value)) {
    throw new CallError('arguments', 'Tool arguments must be an object')
  }
  return value as Record<string, unknown>
}

// A tool's arguments, checked: the JSON Schema the declaration carries, or the
// legacy per-property schemas that parse themselves.
let checked = (
  tool: NamedTool,
  args: Record<string, unknown>,
): Record<string, unknown> => {
  try {
    if (tool.inputSchema && tool.input) {
      throw new Error('Tool cannot declare both input and inputSchema')
    }
    if (tool.inputSchema) return validateToolInput(tool, args)
    let out = { ...args }
    for (let [key, schema] of Object.entries(tool.input ?? {})) {
      let parser = schema as { parse?: (value: unknown) => unknown }
      if (!parser?.parse) {
        throw new Error('Legacy schema requires a parse adapter: ' + key)
      }
      out[key] = parser.parse(out[key])
    }
    return out
  } catch (error) {
    if (error instanceof CallError) throw error
    throw new CallError('arguments', String(error))
  }
}

/**
 * Build a runner over a graph.
 *
 * ```ts
 * let r = runner(g, { tools })
 * g.use(r.plugin)
 * await r.ensure()
 * let answer = await r.call([
 *   { entity: { eid: '$c' }, call: { to: toolEid('text_echo'), args: '{}' } },
 * ])
 * ```
 */
export let runner = (g: Graph, opts: Opts): Runner => {
  let tools = opts.tools.map(namedTool)
  let by = new Map(tools.map((t) => [t.eid ?? toolEid(t.name), t]))
  let now = opts.now ?? (() => performance.now())
  let host = opts.host ?? g
  // A rule this graph has no words for is INERT rather than a query that
  // throws: `call_waiting` names the wake components, and a graph that
  // schedules nothing never loaded them (@yaks/graph's rules read the same
  // way — a rule about a component that is not here says nothing).
  let plans: Ready[] = ready(RULES).filter((p) =>
    reads(p.plan, g.vocab).every((name) =>
      !!g.vocab.comp(name) || !!g.vocab.assoc(name)
    )
  )
  let answering = plans.find((p) => p.rule.name == READY)!
  // What a call is running RIGHT NOW in this process, and what the last few
  // answered — so a host that wrote a call reads the same bundles the runner
  // landed, without asking the graph to reassemble them.
  let running = new Map<Eid, Promise<Bundle[]>>()
  let answers = new Map<Eid, Bundle[]>()
  let keep = (id: Eid, bundles: Bundle[]) => {
    answers.set(id, bundles)
    for (let old of [...answers.keys()].slice(0, -256)) answers.delete(old)
    return bundles
  }

  // The answer, read back out of the graph: the result the rule named, and
  // whatever says it came from this call. What a host sees when another
  // process ran the tool.
  let recalled = async (id: Eid): Promise<Bundle[]> => {
    let result = await g.read(`.result.call=${id}`)
    if (!result.length) return []
    let made = await g.read(`.output.source=${id}`)
    return [...made, ...result]
  }

  // The result entity, as the RULE writes it: one binding of `call_ready`,
  // emitted. The id is derived from the firing, so it is the same entity
  // however many times a call is answered.
  let attached = (id: Eid, ms: number): Bundle => {
    let name = answering.plan.patterns[0].entity!
    let [made] = emitted(answering, {
      entities: [id, null],
      vars: { [name]: id },
    }, g.vocab)
    return { ...made, result: { ...made.result as Comp, ms } }
  }

  let perform = async (
    id: Eid,
    o: { redrive?: boolean },
  ): Promise<Bundle[]> => {
    let [call] = await g.storage.tx((tx) => tx.get([id]))
    if (!call?.call) throw new CallError('call', 'Not a call: ' + id)
    let held = await recalled(id)
    if (held.length) return held
    if (call.execution && !o.redrive) throw new UnfinishedCall(id)
    let c = call.call as Comp
    let tool = by.get(String(c.to))
    // The claim. A call this runner has no tool for is left alone: another
    // runner may own it, and a refusal here would be this one's opinion about
    // somebody else's work.
    if (!tool) return []
    await g.apply([{
      entity: call.entity,
      execution: { state: 'running' },
      $was: {
        execution: { state: o.redrive ? token('running') : null },
        call: { to: token(c.to), args: token(c.args) },
      },
    }])
    let started = now()
    let made: Bundle[] = []
    let state = 'done'
    try {
      let args = checked(tool, parsed(c.args))
      let ctx: ToolCtx = {
        graph: host,
        actor: who(call),
        read: (query, readOpts) => host.read(query, readOpts),
        args,
        call: id,
      }
      made = signed(await tool.run([call], ctx), ctx.actor)
    } catch (error) {
      state = 'failed'
      if (!(error instanceof CallError)) opts.report?.(error, call)
      made = [{
        entity: { eid: '$fault' },
        content: { body: String(error) },
        output: { source: id },
        ...error instanceof CallError
          ? { error: { code: error.code } }
          : { exception: {} },
      }]
    }
    let result = attached(id, Math.round(now() - started))
    let landed = await g.apply([
      ...made,
      { ...result, content: { body: worded(made) } },
      {
        entity: call.entity,
        execution: { state },
        $was: { execution: { state: token('running') } },
      },
    ])
    return keep(id, landed)
  }

  let run = (id: Eid, o: { redrive?: boolean } = {}): Promise<Bundle[]> => {
    let held = running.get(id)
    if (held) return held
    let pending = perform(id, o).finally(() => running.delete(id))
    running.set(id, pending)
    return pending
  }

  // The queue: what the answering rule selects, less what the waiting one
  // does. A rule's match IS the query — its first pattern is the call — so
  // this asks the storage the same question the compiler would.
  let queued = async (): Promise<Bundle[]> => {
    let open = await g.read(answering.plan.patterns[0].filter)
    let waiting = plans.find((p) => p.rule.name == WAITING)
    if (!waiting || !open.length) return open
    let held = new Set(
      (await g.read(waiting.plan.patterns[0].filter))
        .map((b) => b.entity.eid),
    )
    return open.filter((b) => !held.has(b.entity.eid))
  }

  let drive = async (o: { redrive?: boolean } = {}): Promise<Bundle[]> => {
    let out: Bundle[] = []
    for (let call of await queued()) {
      let id = call.entity.eid
      // Claimed and not this pass's to take: either it is running here (the
      // promise is the answer) or another process holds it.
      if (running.has(id)) continue
      if (call.execution && !o.redrive) continue
      try {
        out.push(...await run(id, o))
      } catch (error) {
        opts.report?.(error, call)
      }
    }
    return out
  }

  let answered = (id: Eid): Promise<Bundle[]> => {
    let held = answers.get(id)
    if (held) {
      answers.delete(id)
      return Promise.resolve(held)
    }
    return running.get(id) ?? run(id)
  }

  return {
    tools,
    plugin: {
      name: 'tools',
      vocab: [toolsDoc],
      // Post-commit, and only about a batch that wrote a call: the queue is
      // read when something asked for work, never on every write. What a crash
      // left behind is `reconcile`'s, at boot.
      hooks: {
        effect: async (bundles) => {
          if (bundles.some((b) => b.call)) await drive()
          return bundles
        },
      },
    },
    ensure: () =>
      Promise.resolve(g.apply(
        tools.map((t) => ({
          entity: { eid: t.eid ?? toolEid(t.name) },
          tool: { name: t.name, description: t.description },
        })),
      )),
    call: async (change) => {
      let applied = await g.apply(change)
      let made = applied.find((b) => b.call)
      if (!made) throw new CallError('call', 'a call batch needs a call')
      return answered(made.entity.eid)
    },
    run,
    drive,
  }
}

/** What a crash left: every call the rules still select, re-driven once,
 * claim and all. Call it at boot, after the tools are registered. */
export let reconcile = (r: Runner): Promise<Bundle[]> =>
  r.drive({ redrive: true })
