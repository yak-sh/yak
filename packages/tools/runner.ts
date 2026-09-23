// The runner: the one place a tool function is called, and the record it
// leaves behind. A tool is a function `(bundles, ctx) => bundles`, and knows
// nothing about the `call` and `result` components. A caller can invoke one
// directly and get its bundles back; what this file adds is the stored record,
// which is why callers normally go through here: the `call` entity recording
// what was asked, the `result{call, ms}` recording what came back, and the
// `execution{state}` recording that a run is in flight.
//
// The result entity is emitted by a declared rule (./vocab.json, @yaks/graph
// `emitted`), so its id is derived from the match — `call_ready(<the call>)` —
// and the same call names the same result entity in this process, in another
// process, or a year later. Running a call twice patches one entity, never
// two.
//
// Finding a call another process wrote — one scheduled for later, one a crash
// left behind — is not this file's job. That is an effect, and the rules here
// are the patterns to register it on (@yaks/effects `on`):
//
//   fx.on('$call .call, !results, !wake', (e) => run.run(e.entity.eid))
//   fx.on('$call .call, .wake, .fired, !results', (e) => run.run(e.entity.eid))
//
// one registration each, nothing more. `drive()` runs those same two queries
// once, which is what a boot sweep is.
//
// At most once, and how a crash is recovered: `execution{state, by}` on the
// call is the claim. The runner writes `running` with a `$was` precondition
// that the property was absent, so a second server loses the race instead of
// running the tool twice; it writes `done` or `failed` when the result is
// applied. A call left `running` by a process that died has no result, so the
// same rules still select it, and `reconcile()` at boot runs it again,
// claiming over the stale `running`. `by` records whose claim it is: a runner
// re-runs its own claims and leaves another process's alone, which is what a
// transcript imported from another machine needs — every call in it arrives
// already executed. The exception is a holder that has finished: a process
// writes its `exit` row in the last transaction it will ever write, so a call
// it left `running` has nobody coming back to finish it. That claim has
// lapsed, and the next sweep takes it the way a re-run takes one — which is
// what makes a crash recoverable now that a restarted process is a new entity
// rather than a reused name.
//
// The identity is the caller's. The bundles a tool returns are stamped with
// whoever wrote the call, never with the process running it, so authorization
// is decided about the caller. The runner's own bookkeeping — the result and
// the execution rows — belongs to the server and carries no identity at all.

import {
  type Actor,
  asked,
  type Bundle,
  type Comp,
  type Declared,
  type Eid,
  emitted,
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
import { derivedEid, identityEid } from '@yaks/graph'
import { rulesIn } from '@yaks/vocab'
import { validateToolInput } from '@yaks/vocab/tools'
import { toolsDoc } from './vocab.ts'

// What each call is doing right now in this process, and what the last few
// returned — keyed per graph, not per runner. When a request handler calls a
// tool and an effect finds the same call, there is one claimant and one answer
// between them: the second finds the first's promise instead of racing it, and
// reads the bundles that were written for it whichever one ran. This memo is
// what makes that work for a read-only tool, whose answer is never written
// down.
let running = new WeakMap<Graph, Map<Eid, Promise<Bundle[]>>>()
let answers = new WeakMap<Graph, Map<Eid, Bundle[]>>()
let per = <V>(at: WeakMap<Graph, Map<Eid, V>>, g: Graph): Map<Eid, V> => {
  let mine = at.get(g)
  if (!mine) at.set(g, mine = new Map())
  return mine
}

/** A stored claim exists but no result does. The caller must reconcile it:
 * running the tool again could repeat an effect the outside world already
 * saw. */
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

/** The two rules this package declares, as written in the vocabulary: the
 * call that is due now, and the one that is due once its wake has fired. */
export let RULES: Declared[] = rulesIn(toolsDoc)
  .filter((r) => r.phase == 'effect')

/** The rule that selects a call due now — the one whose emit names the result
 * entity. */
export let READY = 'call_ready'

/** The rule that selects a deferred call once its wake has fired. */
export let WOKEN = 'call_woken'

/** The entity id a call points at for a tool of this name: the id the
 * vocabulary's `identity` on `tool.name` derives, so a graph's tool rows are
 * the same rows every time a runner is built. */
export let toolEid = (name: string): Eid => identityEid('tool', [name])

/** What a runner is built with. */
export type Opts = {
  /** what it can run */
  tools: Tool[]
  /** the graph the tools read and write, when that is not the graph the calls
   * are recorded in (a server that keeps its call records separately) */
  host?: Graph
  /** where unexpected defects are reported, with the call and the name of the
   * tool it asked for; they are not thrown, because the transaction has
   * already committed. A refusal (`CallError`) is never reported. A report
   * that answers a promise is awaited before the call's answer is. */
  report?: (err: unknown, call: Bundle, tool?: string) => unknown
  /** what answers a call naming a tool this runner does not have. Omitted,
   * nothing does: the call is left for whichever runner has that tool. */
  otherwise?: Tool
  /** the clock `result.ms` is measured with (default: `performance.now`) */
  now?: () => number
  /** which entity this runner runs as: its claims record it in
   * `execution.by`, and a call held by anyone else is left alone — a
   * transcript imported from elsewhere arrives already executed, held by the
   * process that made the calls, and no boot pass here re-runs it. A holder
   * that has written an `exit` row holds nothing: its calls are free. Omitted,
   * this runner claims anonymously and takes any call nobody else holds. */
  owner?: Eid
  /** the working directory the process running these calls is in, for a tool
   * that acts on the machine rather than the graph. The caller supplies it;
   * this package touches no runtime API and never looks it up. */
  cwd?: string
}

/** A live runner: the rules a sweep queries, and the functions a caller
 * invokes. */
export type Runner = {
  /** the rules a deferred call is found by — what an effect registers on */
  rules: Ready[]
  /** the tools it runs, named */
  tools: NamedTool[]
  /** write the `tool` rows that calls point at — done once per runner however
   * many times it is called, so a request handler may call it on the way into
   * every request */
  ensure: () => Promise<Bundle[]>
  /** invoke a tool: the call's bundles in, the answer's bundles out */
  call: (bundles: Bundle[]) => Promise<Bundle[]>
  /** run one call that is already in the graph */
  run: (call: Eid, opts?: { redrive?: boolean }) => Promise<Bundle[]>
  /** run every call the rules select: one sweep, which is what a boot pass
   * does with `redrive` set, for the calls a crash left claimed */
  drive: (opts?: { redrive?: boolean }) => Promise<Bundle[]>
}

// A tool's answer as text: the `content{body}` values its bundles carry, or
// the bundles themselves as JSON when they carry none. It is copied onto the
// result entity as `content{body}` so a model, a terminal and a transcript all
// read the answer the same way.
export let worded = (answer: Bundle[]): string => {
  let said = answer
    .map((b) => (b.content as Comp | undefined)?.body)
    .filter((body): body is string => typeof body == 'string')
  return said.length ? said.join('\n') : JSON.stringify(answer, null, 2)
}

/**
 * A tool's answer as data, for a reader that parses rather than reads: the
 * bundles under `result`, or, from a tool that declares an `outputSchema`
 * because its answer is not entities, the `output{value}` it answered in that
 * shape. A refusal carries no such value, and is its bundles like any other.
 * MCP sends this as `structuredContent`; `yak … --json` prints it.
 */
export let structured = (
  tool: { outputSchema?: Record<string, unknown> },
  answer: Bundle[],
): Record<string, unknown> => {
  let value = tool.outputSchema
    ? answer
      .map((b) => (b.output as Comp | undefined)?.value)
      .find((v) => v && typeof v == 'object')
    : undefined
  return (value as Record<string, unknown>) ?? { result: answer }
}

// Who wrote the call, as the graph recorded it. A transaction's `$actor` is
// read by the write pipeline and never stored as a property, so what survives
// the commit is the stamp the provenance rule wrote — which is the point: the
// caller is a fact recorded about the call, not something the runner has to be
// told again. Both halves come back, so what a tool writes is attributed to
// the caller and to the same run the call arrived through.
let who = (call: Bundle): Actor | null => {
  let said = (prop: 'by' | 'via') =>
    (call.created as Comp | undefined)?.[prop] ?? call.$actor?.[prop]
  let by = said('by')
  let via = said('via')
  return by || via
    ? {
      ...(by ? { by: String(by) } : {}),
      ...(via ? { via: String(via) } : {}),
    }
    : null
}

/**
 * Did this call fail? Read from the runner's own record — `execution{state}`
 * on the call — rather than guessed from the shape of the answer: a tool that
 * queries for broken rows returns entities carrying `error` and `exception`,
 * and reporting faults is not itself a fault.
 */
export let faulted = (landed: Bundle[]): boolean =>
  landed.some((b) => (b.execution as Comp | undefined)?.state == 'failed')

/**
 * What a call answered, for display: the tool's own bundles, with the runner's
 * bookkeeping filtered out. The result entity carries a copy of the answer's
 * text so a transcript can show one line per result; a caller rendering the
 * answer itself would otherwise show it twice.
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

// A tool's arguments, validated against the JSON Schema on its declaration, or
// against the legacy per-property schemas that parse themselves.
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
 * // the call entity is the record; the answer is the tool's own bundles
 * let answer = await r.call([
 *   { entity: { eid: '$c' }, call: { to: toolEid('text_echo'), args: '{}' } },
 * ])
 * ```
 *
 * Nothing polls the graph for calls. A server that wants the deferred ones too
 * registers the rules as effects — `for (let r of run.rules)
 * fx.on(r.plan, (e) => run.run(e.entity.eid))` — and calls `reconcile()` at
 * boot for whatever a crash left claimed.
 */
export let runner = (g: Graph, opts: Opts): Runner => {
  let tools = opts.tools.map(namedTool)
  let by = new Map(tools.map((t) => [toolEid(t.name), t]))
  let otherwise = opts.otherwise && namedTool(opts.otherwise)
  let now = opts.now ?? (() => performance.now())
  let host = opts.host ?? g
  // The rules as this graph can query them (@yaks/graph `asked`). A graph that
  // schedules nothing never loaded the wake components: there `!wake` matches
  // everything and drops out, and `call_woken`, which requires them, never
  // matches — one rule text, correct in both graphs.
  let plans: Ready[] = ready(RULES)
    .map((p) => ({ ...p, plan: asked(p.plan, g.vocab) }))
    .filter((p): p is Ready => !!p.plan)
  let answering = plans.find((p) => p.rule.name == READY)!
  let woken = plans.find((p) => p.rule.name == WOKEN)
  let inflight = per(running, g)
  let landings = per(answers, g)
  // Whose claim a call carries, as this runner reads it. Unclaimed, or claimed
  // by this runner, is `free`. Another process's claim is `theirs` — unless
  // that process wrote an `exit` row, which makes the claim `lapsed`: nothing
  // is coming back to finish the call, so it is taken the way a re-run takes
  // one, claiming over `running`. The holder entity is fetched whole rather
  // than queried by `.exit`, so a graph that tracks no processes simply never
  // finds one — this package reads a component by name and requires nothing of
  // the vocabulary.
  let whose = async (call: Bundle): Promise<'free' | 'lapsed' | 'theirs'> => {
    let by = (call.execution as Comp | undefined)?.by
    if (by == null || by == opts.owner) return 'free'
    let [holder] = await g.storage.tx((tx) => tx.get([String(by)]))
    return holder?.exit ? 'lapsed' : 'theirs'
  }
  // The last few answers, keyed by call. Bounded on purpose: this memo is a
  // convenience for the caller that is about to ask, never a cache of the
  // graph.
  let keep = (id: Eid, bundles: Bundle[]) => {
    landings.set(id, bundles)
    for (let old of [...landings.keys()].slice(0, -256)) landings.delete(old)
    return bundles
  }
  let ensured: Promise<Bundle[]> | undefined

  // The answer, read back out of the graph: the result entity the rule named,
  // plus every entity recording that it came from this call. This is what a
  // caller sees when another process ran the tool. A read-only tool's answer
  // was never written, so only the result comes back for one, and the way to
  // see the answer again is to call it again.
  let recalled = async (id: Eid): Promise<Bundle[]> => {
    let result = await g.read(`.result.call=${id}`)
    if (!result.length) return []
    let made = await g.read(`.output.source=${id}`)
    return [...made, ...result]
  }

  // The result entity, built the way the rule would write it: one match of
  // `call_ready`, emitted. Its id is derived from that match, so it is the
  // same entity however many times a call is run.
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
    // A recurring call is not one invocation: it is the row that keeps asking
    // for one. Each firing writes its own call entity, with an id derived from
    // the schedule and the instant it fired, and that new call is what runs —
    // so a finished call is never re-run, the record shows how many times the
    // schedule fired, and the schedule itself stays a standing request. A
    // one-shot has nothing to advance and runs in place.
    let every = (call.wake as Comp | undefined)?.every
    let went = (call.fired as Comp | undefined)?.at
    if (every && went) {
      let asked = call.call as Comp
      let each = derivedEid(`call ${id} ${went}`)
      await g.apply(signed([{
        entity: { eid: each },
        call: { to: asked.to, args: asked.args, source: id },
      }], who(call)))
      return run(each)
    }
    let held = await recalled(id)
    if (held.length) return held
    // A live holder's claim is not this runner's to take, redrive or not; a
    // lapsed one is taken here and now, without waiting for a boot sweep.
    let hold = await whose(call)
    if (hold == 'theirs') return []
    let redrive = o.redrive || hold == 'lapsed'
    if (call.execution && !redrive) throw new UnfinishedCall(id)
    let c = call.call as Comp
    let tool = by.get(String(c.to)) ?? otherwise
    // The claim. A call naming a tool this runner does not have is left alone:
    // another runner may have that tool, and failing the call here would be
    // this runner's verdict on somebody else's work.
    if (!tool) return []
    await g.apply([{
      entity: call.entity,
      execution: {
        state: 'running',
        ...(opts.owner ? { by: opts.owner } : {}),
      },
      $was: {
        execution: { state: redrive ? token('running') : null },
        call: { to: token(c.to), args: token(c.args) },
      },
    }])
    let started = now()
    // What a thrown error becomes: the fault as its own entity, recording
    // which call it came from. An expected refusal gets `error{code}`;
    // anything else is a defect, passed to `report` as well as recorded.
    let faulted = async (error: unknown): Promise<Bundle[]> => {
      if (!(error instanceof CallError)) {
        await opts.report?.(error, call, tool.name)
      }
      return [{
        entity: { eid: '$fault' },
        content: { body: String(error) },
        output: { source: id },
        ...error instanceof CallError
          ? { error: { code: error.code } }
          : { exception: {} },
      }]
    }
    // Writing the answer. A read-only tool's answer is not a write — its
    // bundles are entities that already exist, and applying them would patch
    // every row the query found and move its `updated` stamp — so a read
    // writes only the runner's bookkeeping and returns the answer as the tool
    // built it. A failure is written either way: an error is worth recording
    // whatever the tool was. A rehearsal's answer is what a write would have
    // been, and is not written either.
    let land = async (
      made: Bundle[],
      state: string,
      keeps = !tool.readOnly || state == 'failed',
    ): Promise<Bundle[]> => {
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
        ...(opts.cwd ? { cwd: opts.cwd } : {}),
      }
      let made = signed(await tool.run([call], ctx), ctx.actor)
      // A rehearsal: `check: true` to a tool that writes runs the write's
      // every phase and rolls it back, so the answer is the batch as a kept
      // write would have returned it, or the refusal it would have met.
      if (!tool.readOnly && args.check === true) {
        return await land(
          await host.apply(made, { check: true }),
          'done',
          false,
        )
      }
      return await land(made, 'done')
    } catch (error) {
      // This catches both the tool's own throw and a rejection of what it
      // returned: a transaction the graph refuses is this call's failure,
      // rather than a call left claimed with nothing recorded about it.
      return await land(await faulted(error), 'failed')
    }
  }

  let run = (id: Eid, o: { redrive?: boolean } = {}): Promise<Bundle[]> => {
    let held = inflight.get(id)
    if (held) return held
    let pending = perform(id, o).finally(() => inflight.delete(id))
    inflight.set(id, pending)
    return pending
  }

  // The queue: every call either rule selects, queried once. A rule's match IS
  // the query — its first pattern is the call — so this asks storage the same
  // question an effect registered on that pattern would.
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
      // Claimed and not this pass's to take: either it is already running in
      // this process (the in-flight promise is the answer) or another process
      // holds it.
      if (inflight.has(id)) continue
      let hold = await whose(call)
      if (hold == 'theirs') continue
      let redrive = o.redrive || hold == 'lapsed'
      if (call.execution && !redrive) continue
      try {
        out.push(...await run(id, { redrive }))
      } catch (error) {
        let to = String((call.call as Comp | undefined)?.to)
        await opts.report?.(error, call, by.get(to)?.name)
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
          entity: { eid: toolEid(t.name) },
          tool: { name: t.name, description: t.description },
        })),
      )),
    call: async (bundles) => {
      // The call is written first, because it is the record: what was asked
      // stands whether or not an answer ever does. Then the tool runs — here,
      // in this process, for this caller — unless an effect on the same commit
      // got there first, in which case its answer is this caller's answer.
      let applied = await g.apply(bundles)
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

/** Recover what a crash left behind: every call the rules still select, run
 * once more, stale claim and all. Call it at boot, after the tools are
 * registered. */
export let reconcile = (r: Runner): Promise<Bundle[]> =>
  r.drive({ redrive: true })
