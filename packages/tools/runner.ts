// The RUNNER: the one thing that calls a tool function, and the record it
// leaves. A tool is a function from BUNDLES to BUNDLES — `(bundles, host) =>
// bundles` — and nothing about it lives on `call` and `result`. A HOST invokes
// it directly and gets its bundles back; what this file adds is the
// TRANSCRIPT, which is why a host typically comes through here: the `call`
// entity that says what was asked, the `result{call, ms}` that says what came
// back, and the `execution{state}` that says a run is in flight.
//
// The result entity is a declared RULE's own emit (./vocab.json, @yaks/graph
// `emitted`), so its id is DERIVED from the firing — `call_ready(<the call>)`
// — and the same call names the same result entity in this process, another
// process, or a year later. Answering twice patches one entity, never two.
//
// A call somebody ELSE wrote — one scheduled for later, one a crash left
// behind — is not this file's problem to notice. That is an EFFECT, and the
// rules here are the patterns to register it on (@yaks/effects `on`):
//
//   fx.on('$call .call, !results, !wake', (e) => run.run(e.entity.eid))
//   fx.on('$call .call, .wake, .fired, !results', (e) => run.run(e.entity.eid))
//
// one registration each, nothing special here. `drive()` is the same two
// queries asked once, which is what a boot sweep is.
//
// AT MOST ONCE, and how a crash is recovered: `execution{state}` on the call
// is the claim. The runner writes `running` under a `$was` that the column was
// absent, so a second host loses the race rather than running the tool again;
// it writes `done` or `failed` when the answer lands. A call left `running` by
// a process that died has no result, so the same rules still select it — and
// `reconcile()` at boot re-drives it, claiming over `running` this time.
//
// THE ACTOR IS THE CALLER'S. Whoever wrote the call is who the tool's bundles
// are signed as, never the process running them, so authorization is decided
// about the person asking. The runner's own bookkeeping — the result, the
// execution — is the server's and carries no actor at all.

import {
  asked,
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

// What a call is doing RIGHT NOW in this process, and what the last few came
// to — per GRAPH, not per runner. A door that calls a tool and an effect that
// found the same call are one claimant and one answer between them: the second
// finds the first's promise instead of racing it, and reads the bundles that
// were landed for it whichever ran them. The memo is what makes that true for
// a READING tool, whose answer is never written down.
let running = new WeakMap<Graph, Map<Eid, Promise<Bundle[]>>>()
let answers = new WeakMap<Graph, Map<Eid, Bundle[]>>()
let per = <V>(at: WeakMap<Graph, Map<Eid, V>>, g: Graph): Map<Eid, V> => {
  let mine = at.get(g)
  if (!mine) at.set(g, mine = new Map())
  return mine
}

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

/** The rule that answers a SCHEDULED call once its wake has fired. */
export let WOKEN = 'call_woken'

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

/** A live runner: the rules a sweep asks, and the doors a host calls through. */
export type Runner = {
  /** the rules a scheduled call is found by — what an effect registers on */
  rules: Ready[]
  /** the tools it runs, named */
  tools: NamedTool[]
  /** write the `tool` rows the calls point at — once per runner, whoever
   * asks, so a door may call it on the way into every request */
  ensure: () => Promise<Bundle[]>
  /** ask a tool: the call bundles in, the answer's bundles out */
  call: (change: Change) => Promise<Bundle[]>
  /** run one call that is already in the graph */
  run: (call: Eid, opts?: { redrive?: boolean }) => Promise<Bundle[]>
  /** every call the rules select, run: one sweep, which is what a boot pass
   * does with `redrive` for the ones a crash left claimed */
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
 * Did this call FAIL? The runner's own word for it — `execution{state}` on the
 * call — and not a guess from the answer's shape: a tool that reads break rows
 * answers entities wearing `error` and `exception`, and a listing of faults is
 * not a fault.
 */
export let faulted = (landed: Bundle[]): boolean =>
  landed.some((b) => (b.execution as Comp | undefined)?.state == 'failed')

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
 * await r.ensure()
 * // the call is the transcript; the answer is the tool's own bundles
 * let answer = await r.call([
 *   { entity: { eid: '$c' }, call: { to: toolEid('text_echo'), args: '{}' } },
 * ])
 * ```
 *
 * Nothing watches the graph for calls. A host that wants the scheduled ones
 * too registers the rules as effects — `for (let r of run.rules)
 * fx.on(r.plan, (e) => run.run(e.entity.eid))` — and calls `reconcile()` at
 * boot for what a crash left claimed.
 */
export let runner = (g: Graph, opts: Opts): Runner => {
  let tools = opts.tools.map(namedTool)
  let by = new Map(tools.map((t) => [t.eid ?? toolEid(t.name), t]))
  let now = opts.now ?? (() => performance.now())
  let host = opts.host ?? g
  // The rules as THIS graph can ask them (@yaks/graph `asked`). A graph that
  // schedules nothing never loaded the wake words: there `!wake` says nothing
  // and comes out, and `call_woken`, which requires them, is inert — one rule
  // text, right in both graphs.
  let plans: Ready[] = ready(RULES)
    .map((p) => ({ ...p, plan: asked(p.plan, g.vocab) }))
    .filter((p): p is Ready => !!p.plan)
  let answering = plans.find((p) => p.rule.name == READY)!
  let woken = plans.find((p) => p.rule.name == WOKEN)
  let inflight = per(running, g)
  let landings = per(answers, g)
  // The last few answers, by call. Bounded: a memo is a convenience for the
  // caller that is about to ask, never a cache of the graph.
  let keep = (id: Eid, bundles: Bundle[]) => {
    landings.set(id, bundles)
    for (let old of [...landings.keys()].slice(0, -256)) landings.delete(old)
    return bundles
  }
  let ensured: Promise<Bundle[]> | undefined

  // The answer, read back out of the graph: the result the rule named, and
  // whatever says it came from this call. What a host sees when another
  // process ran the tool — a READ's answer was never written, so what comes
  // back for one is the result alone and the way to see it again is to ask
  // again.
  let recalled = async (id: Eid): Promise<Bundle[]> => {
    let result = await g.read(`.result.call=${id}`)
    if (!result.length) return []
    let made = await g.read(`.output.source=${id}`)
    return [...made, ...result]
  }

  // The result entity, as the RULE writes it: one binding of `call_ready`,
  // emitted. The id is derived from the firing, so it is the same entity
  // however many times a call is answered.
  let attached = (id: Eid, ms: number, sleeps = false): Bundle => {
    let rule = sleeps && woken ? woken : answering
    let name = rule.plan.patterns[0].entity!
    let [made] = emitted(rule, {
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
    // What a throw comes to: the fault as its own entity, saying which call it
    // came from. An expected refusal wears `error{code}`; anything else is a
    // defect, reported as well as recorded.
    let faulted = (error: unknown): Bundle[] => {
      if (!(error instanceof CallError)) opts.report?.(error, call)
      return [{
        entity: { eid: '$fault' },
        content: { body: String(error) },
        output: { source: id },
        ...error instanceof CallError
          ? { error: { code: error.code } }
          : { exception: {} },
      }]
    }
    // The landing. A READING tool's answer is not a write — its bundles are
    // entities that already exist, and landing them would patch every row a
    // query found and move its `updated` stamp — so a read lands its
    // bookkeeping alone and hands the answer back as the tool said it. A
    // failure lands either way: an error is a record whatever the tool was.
    let land = async (made: Bundle[], state: string): Promise<Bundle[]> => {
      let keeps = !tool.readOnly || state == 'failed'
      let landed = await g.apply([
        ...(keeps ? made : []),
        {
          ...attached(id, Math.round(now() - started), !!call.wake),
          content: { body: worded(made) },
        },
        {
          entity: call.entity,
          execution: { state },
          $was: { execution: { state: token('running') } },
        },
      ])
      return keep(id, keeps ? landed : [...made, ...landed])
    }
    try {
      let args = checked(tool, parsed(c.args))
      let ctx: ToolCtx = {
        graph: host,
        actor: who(call),
        read: (query, readOpts) => host.read(query, readOpts),
        args,
        call: id,
      }
      return await land(signed(await tool.run([call], ctx), ctx.actor), 'done')
    } catch (error) {
      // The tool's own throw AND a refusal of what it answered: a batch the
      // graph would not take is this call's failure, not a call left claimed
      // with nothing said about it.
      return await land(faulted(error), 'failed')
    }
  }

  let run = (id: Eid, o: { redrive?: boolean } = {}): Promise<Bundle[]> => {
    let held = inflight.get(id)
    if (held) return held
    let pending = perform(id, o).finally(() => inflight.delete(id))
    inflight.set(id, pending)
    return pending
  }

  // The queue: every call either rule selects, asked once. A rule's match IS
  // the query — its first pattern is the call — so this asks the storage the
  // same question an effect registered on that pattern would.
  let queued = async (): Promise<Bundle[]> => {
    let out = new Map<Eid, Bundle>()
    for (let p of plans) {
      for (let b of await g.read(p.plan.patterns[0].filter)) {
        out.set(b.entity.eid, b)
      }
    }
    return [...out.values()]
  }

  let drive = async (o: { redrive?: boolean } = {}): Promise<Bundle[]> => {
    let out: Bundle[] = []
    for (let call of await queued()) {
      let id = call.entity.eid
      // Claimed and not this pass's to take: either it is running here (the
      // promise is the answer) or another process holds it.
      if (inflight.has(id)) continue
      if (call.execution && !o.redrive) continue
      try {
        out.push(...await run(id, o))
      } catch (error) {
        opts.report?.(error, call)
      }
    }
    return out
  }

  return {
    rules: plans,
    tools,
    // Once per runner, however many callers ask: a tool row is the same row
    // every time (its id is derived from the name), and writing it again would
    // move an `updated` stamp for nothing.
    ensure: () =>
      ensured ??= Promise.resolve(g.apply(
        tools.map((t) => ({
          entity: { eid: t.eid ?? toolEid(t.name) },
          tool: { name: t.name, description: t.description },
        })),
      )),
    call: async (change) => {
      // The call is written FIRST, because it is the transcript: what was
      // asked stands whether or not the answer ever comes. Then the tool is
      // run — here, by this process, for this caller — unless an effect over
      // the same commit got there first, in which case its answer is this
      // caller's answer.
      let applied = await g.apply(change)
      let made = applied.find((b) => b.call)
      if (!made) throw new CallError('call', 'a call batch needs a call')
      let id = made.entity.eid
      let held = landings.get(id)
      if (held) {
        landings.delete(id)
        return held
      }
      return inflight.get(id) ?? run(id)
    },
    run,
    drive,
  }
}

/** What a crash left: every call the rules still select, re-driven once,
 * claim and all. Call it at boot, after the tools are registered. */
export let reconcile = (r: Runner): Promise<Bundle[]> =>
  r.drive({ redrive: true })
