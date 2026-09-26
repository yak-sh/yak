// The runner: the one place a tool function is called, and the record it
// leaves behind. A tool is a function `(call, graph) => bundles`, handed the
// call entity and nothing else about the request. A caller can invoke one
// directly and get its bundles back; what this file adds is the stored record,
// which is why callers normally go through here: the `call` entity recording
// what was asked, the `result{call, ms}` recording what came back, and the
// `execution{state}` recording that a run is in flight.
//
// The call a tool is handed is the stored one, completed: its arguments
// checked against the tool's schema and the entities they name resolved to
// eids (./args.ts), `created{by, via}` saying who asked even
// where the graph stamps nothing, and `process{pid, command, cwd}` naming the
// program running it where the caller named one. That is a bundle, not a row —
// the stored call never wears `process`.
//
// The result entity is emitted by the declared effect's match (./vocab.json,
// @yaks/graph `emitted`), so its id is derived from the match — `call_ready(<the call>)` —
// and the same call names the same result entity in this process, in another
// process, or a year later. Running a call twice patches one entity, never
// two.
//
// Finding a call another process wrote — one nobody claimed, one scheduled for
// later — is not this file's job. That is an effect, and ./vocab.json declares
// two (`call_ready`, `call_woken`), each a query over calls; a host that runs
// effects handles both with `run.due` (@yaks/effects `handle`), one line each,
// nothing more. A call written claimed owes neither: the caller is running it.
// `drive()` runs those same two queries once, and asks for every claimed call
// with no answer besides, which is what a boot sweep is.
//
// At most once, and how a crash is recovered: `execution{state, by}` on the
// call is the claim. The runner writes `running` with a `$was` precondition
// that the property was absent, so a second server loses the race instead of
// running the tool twice; it writes `done` or `failed` when the result is
// applied. A call asked through `call()` is written already claimed, in the
// same change: the caller asking is the one waiting for the answer, so the
// tool runs where it asked, and every other runner (an effect of the same
// commit, another thread of the process, another process) finds the call held
// from the moment it exists. A call left `running` by a process that died has
// no result, so the same rules still select it, and `reconcile()` at boot runs
// it again, claiming over the stale `running`. `by` records whose claim it is:
// a runner leaves a live process's claim alone, its own process's included,
// since a claim this runner is not running is running in another of the
// process's threads. That is also what a transcript imported from another
// machine needs: every call in it arrives already executed. The exception is
// a holder that has finished: a process
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
  asked,
  type Bundle,
  type Comp,
  type Declared,
  type Eid,
  emitted,
  type Graph,
  mint,
  type NamedTool,
  namedTool,
  type Ready,
  ready,
  signed,
  Stale,
  status,
  token,
  type Tool,
  who,
} from '@yaks/graph'
import { derivedEid, identityEid } from '@yaks/graph'
import { effectsIn } from '@yaks/vocab'
import { CallError, parsed, resolved, validated } from './args.ts'
import { toolsDoc } from './vocab.ts'

// What each call is doing right now in this process, keyed per graph, not per
// runner: a second runner over the same graph that is asked for a call in
// flight finds the first's promise instead of racing it, and an effect finds
// the call taken.
let running = new WeakMap<Graph, Map<Eid, Promise<Bundle[]>>>()

/** A stored claim exists but no result does. The caller must reconcile it:
 * running the tool again could repeat an effect the outside world already
 * saw. */
export class UnfinishedCall extends Error {
  constructor(public call: Eid) {
    super('Call execution was started without a recorded result: ' + call)
    this.name = 'UnfinishedCall'
  }
}

/** The two effects this package declares, as written in the vocabulary: the
 * call that is due now, and the one that is due once its wake has fired —
 * each a query the runner also asks on its own, for what a crash left. */
export let RULES: Declared[] = effectsIn(toolsDoc)
  .flatMap((e) => e.match ? [{ name: e.name, match: e.match }] : [])

/** Every call claimed and not yet answered, whole: what a boot sweep asks for
 * beside the rules, which owe nothing for a claimed call. */
export let HELD = '.call&.execution&!results&*'

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
   * already committed. A refusal (a `CallError`, or an error @yaks/graph's
   * `status` puts below 500) is never reported. A report that answers a
   * promise is awaited before the call's answer is. */
  report?: (err: unknown, call: Bundle, tool?: string) => unknown
  /** what answers a call naming a tool this runner does not have. Omitted,
   * nothing does: the call is left for whichever runner has that tool. */
  otherwise?: Tool
  /** the clock `result.ms` is measured with (default: `performance.now`) */
  now?: () => number
  /** the most characters an answer may take as JSON; past it the call is
   * refused as `too_large` (default {@link MOST}) */
  most?: number
  /** which entity this runner runs as: its claims record it in
   * `execution.by`, and a call held by anyone else is left alone — a
   * transcript imported from elsewhere arrives already executed, held by the
   * process that made the calls, and no boot pass here re-runs it. A holder
   * that has written an `exit` row holds nothing: its calls are free. A claim
   * naming this owner that this runner is not running is left alone too: it
   * is running in another thread of the same process. Omitted, this runner
   * claims anonymously and takes any call nobody else holds. */
  owner?: Eid
  /** the program running these calls on this machine, as @yaks/process
   * records one — `{pid, command, cwd}` — put on every call a tool is handed,
   * for a tool that acts on the machine rather than the graph. The caller
   * supplies it; this package touches no runtime API and never looks it up. */
  process?: Comp
}

/** A live runner: the rules a sweep queries, and the functions a caller
 * invokes. */
export type Runner = {
  /** the queries a deferred call is found by — the two declared effects, by
   * name */
  rules: Ready[]
  /** the tools it runs, named */
  tools: NamedTool[]
  /** write the `tool` rows that calls point at — done once per runner however
   * many times it is called, so a request handler may call it on the way into
   * every request */
  ensure: () => Promise<Bundle[]>
  /** invoke a tool: the call in, the answer's bundles out. The call is
   * written claimed and runs here; an `$alias` eid is given a fresh one. */
  call: (asked: Bundle) => Promise<Bundle[]>
  /** run one call that is already in the graph: its answer if it has one, the
   * same promise if it is in flight here, nothing if a live process holds it,
   * and {@link UnfinishedCall} if it was claimed anonymously and never
   * answered */
  run: (call: Eid, opts?: { redrive?: boolean }) => Promise<Bundle[]>
  /** run one call a rule selected, if it is this runner's to take: what an
   * effect handler calls. A call somebody holds, in flight here included, is
   * left to them rather than awaited or refused. */
  due: (call: Eid, opts?: { redrive?: boolean }) => Promise<Bundle[]>
  /** run every call the rules select: one sweep, which is what a boot pass
   * does with `redrive` set, for the calls a crash left claimed */
  drive: (opts?: { redrive?: boolean }) => Promise<Bundle[]>
  /** end every call this runner claimed and is still running, as
   * `error{code: 'interrupted'}` saying `why`: what a process that is ending
   * before its tools returned writes, so no claim of its own is left to lapse
   * and run again somewhere it was never asked. Given a `holder`, the calls
   * that holder claimed and never answered instead, read from the graph: what
   * is written for a process that ended without writing it itself. */
  interrupt: (why: string, holder?: Eid) => Promise<Bundle[]>
}

/** The most characters of an answer's text {@link worded} says: the copy on
 * the result entity, what a model reads over MCP, a transcript's line. What
 * lies past it is counted, not said — the answer itself is the bundles. */
export let WORDS = 256 * 1024

/** The most characters an answer may take as JSON before the runner refuses
 * it as `too_large`: far below the longest string a JavaScript engine can
 * build, so a door that sends an answer whole (MCP, `/apply`, `--json`) never
 * fails to. */
export let MOST = 64 * 1024 * 1024

// Parts said one after another until `most` characters are spent, the last
// cut where the budget ends, and a line counting the parts left unsaid. Each
// part is said only when it is reached, so the cost is the budget's, never the
// answer's.
let spent = <T>(
  parts: T[],
  say: (part: T) => string,
  sep: string,
  most: number,
): { text: string; left: number } => {
  let text = ''
  let said = 0
  for (let part of parts) {
    let s = (said ? sep : '') + say(part)
    if (text.length + s.length > most) {
      return {
        text: text + s.slice(0, most - text.length),
        left: parts.length - said,
      }
    }
    text += s
    said++
  }
  return { text, left: 0 }
}

// JSON.stringify(answer, null, 2), said one bundle at a time.
let inset = (b: Bundle) =>
  '  ' + JSON.stringify(b, null, 2).replaceAll('\n', '\n  ')

/**
 * A tool's answer as text: the `content{body}` values its bundles carry, or
 * the bundles themselves as JSON when they carry none. It is copied onto the
 * result entity as `content{body}` so a model, a terminal and a transcript all
 * read the answer the same way. It says at most `most` characters and counts
 * the rest, so an answer of any size words in bounded time and space.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let said = (body: string) => ({ entity: { eid: body }, content: { body } })
 * assertEquals(worded([said('one'), said('two')]), 'one\ntwo')
 * assertEquals(
 *   worded([said('one'), said('two'), said('three')], 5),
 *   'one\nt\n… 2 of 3 not said: an answer is worded in 5 characters',
 * )
 * ```
 */
export let worded = (answer: Bundle[], most = WORDS): string => {
  let said = answer
    .map((b) => (b.content as Comp | undefined)?.body)
    .filter((body): body is string => typeof body == 'string')
  let { text, left } = said.length
    ? spent(said, (s) => s, '\n', most)
    : spent(answer, inset, ',\n', most)
  let open = said.length ? '' : '[\n'
  return left
    ? `${open}${text}\n… ${left} of ${said.length || answer.length} ` +
      `not said: an answer is worded in ${most} characters`
    : said.length
    ? text
    : answer.length
    ? `[\n${text}\n]`
    : '[]'
}

// An answer too long to send whole is refused, and so never reaches a door
// that would build its JSON in one string. It is measured one bundle at a
// time, stopping once past `most`, so measuring any answer costs at most that.
let measured = (answer: Bundle[], most: number) => {
  let size = 0
  for (let b of answer) {
    size += JSON.stringify(b).length
    if (size > most) {
      throw new CallError(
        'too_large',
        `the answer is ${answer.length} entities, past the ${most} ` +
          'characters of JSON a call answers in: ask for fewer',
      )
    }
  }
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

/**
 * Build a runner over a graph.
 *
 * ```ts ignore
 * let r = runner(g, { tools })
 * await r.ensure()
 * // the call entity is the record; the answer is the tool's own bundles
 * let answer = await r.call({
 *   entity: { eid: '$c' },
 *   call: { to: toolEid('text_echo'), args: {} },
 * })
 * ```
 *
 * Nothing polls the graph for calls. A server that wants the deferred ones too
 * handles the two effects ./vocab.json declares — `fx.handle({ [r.rule.name]:
 * (e) => run.due(e.entity.eid) })` for each of `run.rules` — and calls
 * `reconcile()` at boot for whatever a crash left claimed.
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
  let inflight = running.get(g) ?? new Map<Eid, Promise<Bundle[]>>()
  running.set(g, inflight)
  // The calls this runner claimed and whose tool has not returned, with when
  // each started: what an interruption ends.
  let held = new Map<Eid, { call: Bundle; started: number }>()
  // Whose claim a call carries, as this runner reads it. Unclaimed, or claimed
  // with no owner named, is `free`. This process's own claim is `mine`: one
  // this runner is not running is running in another thread of this process,
  // or failed there, and either way the process is not over. Another process's
  // claim is `theirs` — unless that process wrote an `exit` row, which makes
  // the claim `lapsed`: nothing is coming back to finish the call, so it is
  // taken the way a re-run takes one, claiming over `running`. The holder
  // entity is fetched whole rather than queried by `.exit`, so a graph that
  // tracks no processes simply never finds one — this package reads a
  // component by name and requires nothing of the vocabulary.
  let whose = async (
    call: Bundle,
  ): Promise<'free' | 'mine' | 'lapsed' | 'theirs'> => {
    let by = (call.execution as Comp | undefined)?.by
    if (by == null) return 'free'
    if (by == opts.owner) return 'mine'
    let [holder] = await g.get([String(by)])
    return holder?.exit ? 'lapsed' : 'theirs'
  }
  let ensured: Promise<Bundle[]> | undefined

  // The answer, read back out of the graph: the result entity the rule named,
  // plus every entity recording that it came from this call. This is what a
  // caller sees when another process ran the tool. A read-only tool's answer
  // was never written, so only the result comes back for one, and the way to
  // see the answer again is to call it again.
  let recalled = async (id: Eid): Promise<Bundle[]> => {
    let result = await g.read(`.result.call=${id}&*`)
    if (!result.length) return []
    let made = await g.read(`.output.source=${id}&*`)
    return [...made, ...result]
  }

  // The result entity, built the way the rule would write it: one match of
  // `call_ready`, emitted. Its id is derived from that match, so it is the
  // same entity however many times a call is run.
  let attached = (id: Eid, ms?: number, sleeps = false): Bundle => {
    let rule = sleeps && woken ? woken : answering
    let name = rule.plan.patterns[0].entity!
    let [made] = emitted(rule, {
      entities: [id, null],
      vars: { [name]: id },
    }, g.vocab)
    return {
      ...made,
      result: { ...made.result as Comp, ...ms == null ? {} : { ms } },
    }
  }

  // The claim this runner writes.
  let claim = (): Comp => ({
    state: 'running',
    ...(opts.owner ? { by: opts.owner } : {}),
  })
  // The tool a call names, as this runner has it. A call naming a tool this
  // runner does not have is left alone: another runner may have that tool,
  // and failing the call here would be this runner's verdict on somebody
  // else's work.
  let toolOf = (call: Bundle): NamedTool | undefined =>
    by.get(String((call.call as Comp).to)) ?? otherwise
  // One promise per call in flight in this process, in the map before the
  // work starts, so nothing the work sets off finds the call untaken.
  let tracked = (id: Eid, go: () => Promise<Bundle[]>): Promise<Bundle[]> => {
    let pending = Promise.resolve().then(go)
      .finally(() => inflight.delete(id))
    inflight.set(id, pending)
    return pending
  }

  // A call written and claimed in one change, then run here. The claim is its
  // own bundle: the call is the caller's, the claim is the runner's
  // bookkeeping and carries no identity. A call somebody claimed first (only
  // a named one can be) reads the way `run` reads it.
  let born = (asked: Bundle): Promise<Bundle[]> => {
    let id = asked.entity.eid.startsWith('$') ? mint() : asked.entity.eid
    let call = { ...asked, entity: { ...asked.entity, eid: id } }
    let tool = toolOf(call)
    return tracked(id, async () => {
      if (!tool) {
        await g.apply([call])
        return []
      }
      try {
        await g.apply([call, {
          entity: { eid: id },
          execution: claim(),
          $was: { execution: { state: null } },
        }])
      } catch (error) {
        if (error instanceof Stale) return perform(id, {})
        throw error
      }
      let [stored] = await g.get([id])
      return execute(stored, tool)
    })
  }

  let perform = async (
    id: Eid,
    o: { redrive?: boolean; due?: boolean },
  ): Promise<Bundle[]> => {
    let [call] = await g.get([id])
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
      let [each] = signed([{
        entity: { eid: derivedEid(`call ${id} ${went}`) },
        call: { to: asked.to, args: asked.args, source: id },
      }], who(call))
      return born(each)
    }
    let held = await recalled(id)
    if (held.length) return held
    // A live process's claim is not this runner's to take, redrive or not,
    // this process's own included: a claim this runner is not running is
    // running in another of its threads. A lapsed one is taken here and now,
    // without waiting for a boot sweep.
    let hold = await whose(call)
    if (hold == 'theirs' || hold == 'mine') return []
    let redrive = o.redrive || hold == 'lapsed'
    if (call.execution && !redrive) {
      if (o.due) return []
      throw new UnfinishedCall(id)
    }
    let tool = toolOf(call)
    if (!tool) return []
    let c = call.call as Comp
    // The claim. A runner that loses it to another has nothing to run.
    try {
      await g.apply([{
        entity: call.entity,
        execution: claim(),
        $was: {
          execution: { state: redrive ? token('running') : null },
          call: { to: token(c.to), args: token(c.args) },
        },
      }])
    } catch (error) {
      if (error instanceof Stale) return []
      throw error
    }
    return execute(call, tool)
  }

  // What ends a claimed call: the result the rule names, worded from what it
  // said, and the claim moved on from `running`, refused if another hand
  // moved it first.
  // How long it ran is left out where nobody saw it start.
  let ending = (
    call: Bundle,
    started: number | undefined,
    state: string,
    said: Bundle[],
  ): Bundle[] => [
    {
      ...attached(
        call.entity.eid,
        started == null ? undefined : Math.round(now() - started),
        !!call.wake,
      ),
      content: { body: worded(said) },
    },
    {
      entity: call.entity,
      execution: { state },
      $was: { execution: { state: token('running') } },
    },
  ]

  // Running a claimed call: the tool, its answer, and the record of both.
  let execute = async (call: Bundle, tool: NamedTool): Promise<Bundle[]> => {
    let id = call.entity.eid
    let c = call.call as Comp
    let started = now()
    held.set(id, { call, started })
    // What a thrown error becomes: the fault as its own entity, recording
    // which call it came from. An expected refusal gets `error{code}`: a
    // `CallError` with its code, or an error the graph's `status` puts below
    // 500 (a `Refused` write, an `Unknown` name) with its name. Anything else
    // is a defect, passed to `report` as well as recorded.
    let faulted = async (error: unknown): Promise<Bundle[]> => {
      let code = error instanceof CallError
        ? error.code
        : status(error) < 500
        ? (error as Error).name
        : undefined
      if (code == undefined) await opts.report?.(error, call, tool.name)
      return [{
        entity: { eid: '$fault' },
        content: { body: String(error) },
        output: { source: id },
        ...code == undefined ? { exception: {} } : { error: { code } },
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
        ...ending(call, started, state, made),
      ])
      return keeps ? landed : [...made, ...landed]
    }
    try {
      let args = await resolved(tool, validated(tool, parsed(c.args)), host)
      let actor = who(call)
      let asking: Bundle = {
        ...call,
        call: { ...c, args },
        ...actor ? { created: { ...call.created as Comp, ...actor } } : {},
        ...opts.process ? { process: opts.process } : {},
      }
      let made = signed(await tool.run(asking, host), actor)
      measured(made, opts.most ?? MOST)
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
    } finally {
      held.delete(id)
    }
  }

  let run = (id: Eid, o: { redrive?: boolean } = {}): Promise<Bundle[]> =>
    inflight.get(id) ?? tracked(id, () => perform(id, o))

  let due = async (
    id: Eid,
    o: { redrive?: boolean } = {},
  ): Promise<Bundle[]> =>
    inflight.has(id)
      ? []
      : await tracked(id, () => perform(id, { ...o, due: true }))

  // The queue: every call either rule selects, queried once. A rule's match IS
  // the query — its first pattern is the call — so this asks storage the same
  // question an effect registered on that pattern would. The rules owe nothing
  // for a claimed call, so the claims with no answer are asked for besides:
  // `whose` says which of them have lapsed.
  let queued = async (): Promise<Bundle[]> => {
    let out = new Map<Eid, Bundle>()
    for (let p of plans) {
      // Whole (`*`): a call is run as it stands, not as the pattern names it.
      let { filter } = p.plan.patterns[0]
      let clauses = [...filter.clauses, { kind: 'every' as const }]
      for (let b of await g.read({ ...filter, clauses })) {
        out.set(b.entity.eid, b)
      }
    }
    for (let b of await g.read(HELD)) out.set(b.entity.eid, b)
    return [...out.values()]
  }

  let drive = async (o: { redrive?: boolean } = {}): Promise<Bundle[]> => {
    let out: Bundle[] = []
    for (let call of await queued()) {
      try {
        out.push(...await due(call.entity.eid, o))
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
    // Once per runner, however many callers ask, and only the rows that are
    // missing or say something else: a tool row is the same row every time
    // (its id is derived from the name), and writing it again would move an
    // `updated` stamp for nothing — on every process that opens the graph.
    ensure: () =>
      ensured ??= Promise.resolve(
        g.get(tools.map((t) => toolEid(t.name))),
      ).then((held) => {
        let said = new Map(held.map((b) => [b.entity.eid, b.tool as Comp]))
        let stale = tools.filter((t) => {
          let row = said.get(toolEid(t.name))
          return row?.name != t.name || row?.description != t.description
        })
        return stale.length
          ? g.apply(stale.map((t) => ({
            entity: { eid: toolEid(t.name) },
            tool: { name: t.name, description: t.description },
          })))
          : []
      }),
    // The call is written first, because it is the record: what was asked
    // stands whether or not an answer ever does. It is written claimed, and
    // the tool runs here, in this process, for this caller.
    call: async (asked) => {
      if (!asked.call) throw new CallError('call', 'a call needs a call')
      return await born(asked)
    },
    run,
    due,
    drive,
    // One write per call: a call whose tool returned meanwhile has moved its
    // claim on, and its own answer stands.
    interrupt: async (why, holder) => {
      let out: Bundle[] = []
      let cut: { call: Bundle; started?: number }[] = holder == null
        ? [...held.values()]
        : (await g.read(`.execution.by=${holder}&!results&.call&*`))
          .map((call) => ({ call }))
      for (let { call, started } of cut) {
        let id = call.entity.eid
        let fault: Bundle = {
          entity: { eid: '$fault' },
          content: { body: why },
          output: { source: id },
          error: { code: 'interrupted' },
        }
        try {
          out.push(
            ...await g.apply([
              fault,
              ...ending(call, started, 'failed', [fault]),
            ]),
          )
        } catch (error) {
          if (!(error instanceof Stale)) throw error
        }
      }
      return out
    },
  }
}

/** Recover what a crash left behind: every call the rules still select, run
 * once more, stale claim and all. Call it at boot, after the tools are
 * registered. */
export let reconcile = (r: Runner): Promise<Bundle[]> =>
  r.drive({ redrive: true })
