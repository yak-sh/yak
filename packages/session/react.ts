import { CallError, runner, UnfinishedCall } from '@yaks/tools'
export { CallError as ToolError } from '@yaks/tools'
import { argsOf, Stale, token, transient } from '@yaks/graph'
// The runner's one step. `react(graph, session)` reads the newest entry of a
// transcript and does the one next thing it calls for: a pending input or
// result asks the model; an open tool call is run; an error within the retry
// limit asks the model again; everything else does nothing. It appends what
// happened as entries and returns, so a loop over it is a session, and that
// loop run as pool work is the runner (./run.ts).
//
// It owns no transport and no tools: it is handed a @yaks/model `Model` and a
// table of tools, so the same code runs over @yaks/openai in a CLI, over a
// fake in a test, and inside a Store on Cloudflare. It imports no platform API.
//
// A fork's transcript is the parent's entries up to the anchor plus its own.
// When the model can continue from a kept reply (`model.anchor` returns one for
// the newest ask), the model is asked with that anchor plus only what followed;
// otherwise the conversation is sent every time (`lines`: never the asks,
// errors, or other turns' typed questions and answers kept beside it), or its
// newest lines where the turn's `using.window` bounds them. That one rule is what
// makes a fork's first ask cheap where the provider allows it: the anchor is
// the parent's last reply, and only the fork's new input is sent. What the
// provider keeps about an ask is its own component on the ask entry
// (`model.mark`), which is why only the model can answer the question.

import type {
  Actor,
  Bundle,
  Comp,
  Eid,
  Graph,
  Tool as GraphTool,
} from '@yaks/graph'
import {
  ANSWER,
  type Answer,
  type Item,
  MODEL,
  type Model,
  ModelError,
  QUESTIONS,
  type Questions,
  type Reply,
  type Request,
  TOOL,
  type Tool as Declared,
} from '@yaks/model'
import {
  ASK,
  CALL,
  CONTENT,
  ENTRY,
  ERROR,
  EXCEPTION,
  FORK,
  OUTPUT,
  RESULT,
  USING,
} from './native.ts'
import {
  kindOf,
  newestAsk,
  openCalls,
  ordered,
  seqOf,
  statusOf,
  textOf,
  type TranscriptStatus,
  usingBefore,
} from './status.ts'
import { context, prefix, suffix } from './compact.ts'

/** The caller, supplied by react rather than by model arguments, and a
 * signal that aborts when the process running the transcript is leaving: a
 * tool waiting on something stops waiting (./children.ts `wait`). */
export type ToolContext = {
  session: Eid
  call: Bundle
  entries: Bundle[]
  signal?: AbortSignal
}

/** A refused tool invocation: expected, recorded as an error and a result. */
export { UnknownSession } from './unknown.ts'
import { UnknownSession } from './unknown.ts'
import { took } from './timing.ts'

/** A tool the model may call: its declaration, and how to run it. */
export type Tool = Declared & {
  run: (
    args: Record<string, unknown>,
    ctx?: ToolContext,
  ) => Promise<string> | string
  /** Recover an invocation whose process ended before it recorded a result.
   * Return its known outcome, or nothing when its effects are uncertain. */
  recover?: (
    args: Record<string, unknown>,
    ctx: ToolContext,
  ) => Promise<string | undefined> | string | undefined
}

/** A model as one provider serves it: the adapter that asks, and the name
 * that provider knows the model by (`serves.name`). */
export type Served = { model: Model; name: string }

/** What `react` is handed beside the graph. */
export type Deps = {
  /** Experimental durable request admission with transient text. */
  streaming?: boolean
  /** Minimum interval between durable stream checkpoints; zero disables. */
  checkpointMs?: number
  /** Approximate input-token budget before a transcript is compacted. */
  contextTokens?: number
  model: Model
  /** Choose the provider that serves the model, and what it calls the model. */
  resolveModel?: (using: Comp | undefined, model: Bundle) => Promise<Served>
  tools: Tool[]
  /** Resolve a stable tool registry for one execution step. */
  toolSnapshot?: (phase: 'ask' | 'call', session: Eid) => Promise<Tool[]>
  /** aborts the model request in flight */
  signal?: AbortSignal
  /** aborts when the process running the transcript is leaving: no step
   * starts after it, and a tool waiting on something stops waiting, while the
   * step in flight is let finish */
  stopping?: AbortSignal
  instructions?: string
  /** Resolve inherited base instructions for future asks without rewriting history. */
  resolveInstructions?: (inherited: string | undefined) => string | undefined
  /** Optional bounded model-facing tool-result projection; storage stays unchanged. */
  resultText?: (entry: Bundle) => Promise<string>
  /** Resolve explicitly admitted multimodal context without storing bytes in entries. */
  contextItems?: (window: Bundle[], entries: Bundle[]) => Promise<Item[]>
  /** Unexpected model/tool defects, separate from expected refusals. */
  report?: (error: unknown, session: Eid, phase: string) => void
  mint?: () => Eid
}

/** What one step did. */
export type Step = {
  did: 'asked' | 'ran' | 'nothing'
  status: TranscriptStatus
  /** the entries appended, in order */
  added: Bundle[]
}

let comp = (b: Bundle, name: string) => b[name] as Comp | undefined

// The object a model's JSON text spells, or nothing where it spells none.
let objectIn = (text: string): Record<string, unknown> | undefined => {
  try {
    let value = JSON.parse(text || '{}')
    return value && typeof value == 'object' && !Array.isArray(value)
      ? value
      : undefined
  } catch {
    return undefined
  }
}

/** A transcript's entries: a fork's prefix from its parent up to the anchor,
 * then its own, in order. */
export let transcript = async (g: Graph, session: Eid): Promise<Bundle[]> => {
  let [self] = await g.get([session])
  if (!self?.session) throw new UnknownSession(session)
  let own = await g.read(`.${ENTRY}.session=${session}&*`)
  let from = comp(self, FORK)?.from
  if (!from) return ordered(own)
  let [anchor] = await g.get([String(from)])
  let parent = anchor && comp(anchor, ENTRY)
  if (!parent) return ordered(own)
  let inherited = await transcript(g, String(parent.session))
  return [
    ...inherited.filter((b) => seqOf(b) <= seqOf(anchor)),
    ...ordered(own),
  ]
}

/** The model's view of a window of the transcript: inputs as user turns, what
 * what the model returned as assistant turns, tool calls and results as the
 * pair a
 * model expects. Ask entries are our record, not the model's; a tool call the
 * anchored reply itself asked for is already in the provider's state, so only
 * its result travels. */
export let project = (
  entries: Bundle[],
  tools: Map<Eid, Declared>,
  anchor?: Eid,
  results?: Map<Eid, string>,
): Item[] => {
  let out: Item[] = []
  let byId = new Map(entries.map((b) => [b.entity.eid, b]))
  for (let b of entries) {
    let kind = kindOf(b)
    let c = comp(b, CALL)
    if (b.prompt || b.checkpoint) {
      out.push({ kind: 'instruction', text: textOf(b) })
    } else if (kind == 'input') out.push({ kind: 'user', text: textOf(b) })
    else if (kind == 'output') out.push({ kind: 'assistant', text: textOf(b) })
    else if (kind == 'call' && c?.source != anchor) {
      out.push({
        kind: 'call',
        id: String(c!.id),
        name: tools.get(String(c!.to))?.name ?? 'tool',
        args: c!.args == null ? textOf(b) || '{}' : JSON.stringify(c!.args),
      })
    } else if (kind == 'result') {
      let call = byId.get(String(comp(b, RESULT)?.call))
      let text = results?.get(b.entity.eid) ?? textOf(b)
      let ms = comp(b, RESULT)?.ms
      out.push({
        kind: 'result',
        id: String(comp(call!, CALL)?.id ?? ''),
        output: typeof ms == 'number' ? took(text, ms) : text,
      })
    }
  }
  return out
}

/**
 * The lines of a transcript a turn reads: what a model is sent (inputs,
 * replies, calls and their results), without the record kept beside them
 * (asks, errors), and without the typed questions other turns asked or the
 * answers they got. Those are rows for whoever asked (a page acts on them),
 * not lines of the conversation, so a wake that asks every few minutes never
 * crowds out what was said. `asking` is the entry whose questions this turn
 * asks: it reads that one.
 */
export let lines = (entries: Bundle[], asking?: Bundle): Bundle[] =>
  entries.filter((b) =>
    b == asking ||
    !(QUESTIONS in b || ANSWER in b) &&
      ['input', 'output', 'call', 'result'].includes(kindOf(b) ?? '')
  )

/** The newest `n` lines of a transcript, reaching back to the input that
 * began the turn they cut into, so no call or result is sent without its
 * pair: what a turn sends when its `using.window` is `n`. All of them when
 * `n` is not a count. */
export let recent = (entries: Bundle[], n?: unknown): Bundle[] => {
  let size = Math.floor(Number(n))
  if (!(size >= 1)) return entries
  let from = Math.max(0, entries.length - size)
  while (from > 0 && kindOf(entries[from]) != 'input') from--
  return suffix(entries, from)
}

/** The entry whose typed questions a turn asks: the newest since the
 * transcript's last ask that asks for anything, questions or a model, when it
 * carries questions. So a retry after an error asks them again, and neither a
 * later turn nor a later line choosing a model of its own does: the questions
 * were that model's. */
let askingOf = (entries: Bundle[]): Bundle | undefined => {
  let last = newestAsk(entries)
  let since = last ? seqOf(last) : 0
  let asking = entries.filter((b) =>
    (QUESTIONS in b || USING in b) && seqOf(b) > since
  ).at(-1)
  let asked = asking && comp(asking, QUESTIONS)?.asked
  return asked && typeof asked == 'object' && !Array.isArray(asked)
    ? asking
    : undefined
}

let two = (n: number) => String(Math.round(n * 100) / 100)

/** An answer as the line a later turn reads: `plan: forge, 0.82`. */
let saying = (question: string, a: Answer): string => {
  let said = a.choice ?? [a.score, a.noul].find((n) => n != null)
  let parts = [said, a.confidence]
    .filter((p) => p != null)
    .map((p) => typeof p == 'number' ? two(p) : p)
  return `${question}: ${parts.join(', ')}`
}

/**
 * One step of the runner over one transcript. Reads the newest entry, does the
 * one thing it calls for, appends the entries that record it, and reports what
 * it
 * did. Safe to call when there is nothing to do.
 */
export let react = async (
  g: Graph,
  session: Eid,
  deps: Deps,
): Promise<Step> => {
  let entries = await transcript(g, session)
  let status = statusOf(entries)
  let nothing: Step = { did: 'nothing', status, added: [] }
  let newest = entries.at(-1)
  if (!newest || status == 'settled' || status == 'stopped') return nothing
  if (status == 'failed') return nothing
  let mint = deps.mint ?? (() => crypto.randomUUID() as Eid)
  // Who a line of this turn is written by. The pair is the one the fleet
  // resolves for an agent's write (src/db.ts actorFor/writerVia): the
  // instrument is the transcript it came in on, and the actor is the model
  // answering there — nobody else is at this keyboard. Which model is in force
  // is read off the transcript below, so the signature is taken when a line is
  // minted rather than when this closure is made.
  let signer: Actor = { via: session }
  let line = (extra: Record<string, Comp>, body?: string): Bundle => ({
    entity: { eid: mint() },
    [ENTRY]: { session },
    ...body == null ? {} : { [CONTENT]: { body } },
    ...extra,
    $actor: signer,
  })
  let append = async (added: Bundle[]): Promise<Step> => {
    added = await g.apply(added, { trusted: true })
    return {
      did: 'asked',
      status: statusOf(await transcript(g, session)),
      added,
    }
  }
  let current = async (): Promise<Step> => ({
    did: 'nothing',
    status: statusOf(await transcript(g, session)),
    added: [],
  })
  // Recovery and provider completion race for the same attempt. Guard the
  // whole batch so the loser contributes neither reply items nor an error.
  let finish = async (
    attempt: Bundle,
    patch: Bundle,
    added: Bundle[],
  ): Promise<Step | undefined> => {
    try {
      return await append([{
        ...patch,
        entity: attempt.entity,
        $was: { attempt: { state: token('inflight') } },
      }, ...added])
    } catch (e) {
      if (
        e instanceof Stale && e.eid == attempt.entity.eid &&
        e.comp == 'attempt' && e.prop == 'state'
      ) return
      throw e
    }
  }
  const unfinished = entries.find((b) =>
    (b.attempt as Comp | undefined)?.state == 'inflight'
  )
  if (unfinished) {
    // The request may have reached the provider. Its partial output stays in
    // the transcript, but only a completed ask can be used as an anchor.
    // Continue from that history after the former worker has gone.
    let recovered = await finish(
      unfinished,
      { entity: unfinished.entity, attempt: { state: 'interrupted' } },
      [
        line(
          {},
          'System recovery: the previous response was interrupted. ' +
            'Continue from the transcript. ' +
            'Inspect the state before repeating any action that may have completed.',
        ),
      ],
    )
    return recovered ?? await current()
  }
  const tools = deps.toolSnapshot
    ? await deps.toolSnapshot(
      openCalls(entries).length ? 'call' : 'ask',
      session,
    )
    : deps.tools
  let toolEntities = new Map<Eid, Tool>()
  for (let b of await g.read(`.${TOOL}`)) {
    let t = tools.find((t) => t.name == comp(b, TOOL)?.name)
    if (t) toolEntities.set(b.entity.eid, t)
  }

  // Open tool calls: perform every one the current ask asked for that has no
  // result yet, in one batch, so the model is never asked with a call it made
  // still unanswered (the provider refuses that). A tool that throws is an
  // exception and a result saying so, so the model hears what happened and
  // the session goes on. This is the same set statusOf reads as `running`, so
  // a transcript is never called settled with work left here (T-35230).
  let asked = newestAsk(entries)
  let open = openCalls(entries)
  // A superseded call may already have performed side effects. Do not replay
  // it or send an invalid transcript to the provider; expose it for repair.
  let orphan = open.find((b) => comp(b, CALL)?.source != asked?.entity.eid)
  if (orphan) {
    return append([
      line(
        { [EXCEPTION]: {} },
        `Unanswered tool call from an older request: ${orphan.entity.eid}. ` +
          'Verify execution before recording its result.',
      ),
    ])
  }
  if (open.length) {
    const added: Bundle[] = []
    // The runner is what runs a call — here and everywhere else (@yaks/tools).
    // A session tool answers a string and this is where that becomes bundles:
    // the text it returned, carrying `output{source}` so the result names the
    // call
    // it came from. The runner lands them beside the `result{call, ms}` entity
    // it derives, and that result is the transcript's entry.
    //
    // Its plugin is deliberately not registered on this graph: a call here is
    // run in the order the transcript asked for, one at a time, and an
    // effect-phase runner would race that.
    // What a session tool is, expressed as a graph tool: the text it returns
    // carries `content` and `output{source}`, so the answer names the call it
    // came from and the runner lands it like any other. A call carrying text
    // is one whose model text spelled no object: it has no arguments to run
    // with.
    const served = (tool: Tool): GraphTool => ({
      name: tool.name,
      description: tool.description ?? '',
      inputSchema: tool.parameters,
      run: async (call) => {
        if (textOf(call)) {
          throw new CallError(
            'arguments',
            'Invalid JSON tool arguments: ' + textOf(call),
          )
        }
        return [{
          entity: { eid: '$said' },
          [CONTENT]: {
            body: String(
              await tool.run(argsOf(call), {
                session,
                call,
                entries,
                signal: deps.stopping,
              }),
            ),
          },
          [OUTPUT]: { source: call.entity.eid },
        }]
      },
    })
    // A call naming a tool this session does not serve is answered by a tool
    // that refuses. The runner leaves a call it has no word for alone —
    // another runner may own it — and here nobody else does, so the refusal is
    // the runner's `otherwise` and lands like every other result does.
    const unserved: GraphTool = {
      name: 'unserved',
      description: 'a tool this session does not serve',
      run: (call) => {
        throw new CallError('tool', 'no such tool: ' + comp(call, CALL)?.to)
      },
    }
    const run = runner(g, {
      tools: [...toolEntities.values()].map(served),
      otherwise: unserved,
      report: (error) => deps.report?.(error, session, 'tool'),
    })
    for (const pending of open) {
      try {
        added.push(...await run.run(pending.entity.eid))
      } catch (error) {
        if (!(error instanceof UnfinishedCall)) throw error
        let tool = toolEntities.get(String(comp(pending, CALL)?.to))
        let answer: Bundle[] | undefined
        try {
          let recovered = await tool?.recover?.(argsOf(pending), {
            session,
            call: pending,
            entries,
            signal: deps.stopping,
          })
          if (recovered != null) {
            answer = [{
              entity: { eid: '$said' },
              [CONTENT]: { body: recovered },
              [OUTPUT]: { source: pending.entity.eid },
            }]
          }
        } catch (failure) {
          deps.report?.(failure, session, 'tool-recovery')
        }
        added.push(
          ...await run.interruptCall(
            pending.entity.eid,
            'Tool execution was interrupted. Its effects may have completed. ' +
              'Inspect the state before repeating it.',
            answer,
          ),
        )
      }
    }
    return { did: 'ran', status: statusOf(await transcript(g, session)), added }
  }
  if (status == 'running') return nothing

  // Pending, or an error under the bound: ask the model. The anchor is the
  // newest ask the model can continue from; only what followed it travels.
  let using = usingBefore(entries)
  let modelEid = using?.model == null ? undefined : String(using.model)
  if (modelEid) signer = { by: modelEid, via: session }
  let [modelEntity] = modelEid ? await g.get([modelEid]) : []
  let served = comp(modelEntity ?? {} as Bundle, MODEL)
  let modelName = String(served?.name ?? '')
  if (!modelName) {
    return append([
      line({ [ERROR]: { code: 'no_model' } }, 'no model in force'),
    ])
  }
  const { model: providerModel, name: spelled } = deps.resolveModel
    ? await deps.resolveModel(using, modelEntity!)
    : { model: deps.model, name: modelName }
  // Only completed responses can supply provider continuation state. A partial
  // response remains ordinary visible history after the last completed anchor.
  asked = newestAsk(
    entries.filter((b) =>
      !b.attempt || (b.attempt as Comp).state == 'completed'
    ),
  )
  let checkpoint = entries.filter((b) => b.checkpoint).at(-1)
  const sameModel = asked &&
    (!checkpoint || seqOf(asked) > seqOf(checkpoint)) &&
    comp(asked, ASK)?.to === modelEid &&
    comp(asked, 'using')?.provider === using?.provider
  let anchorId = providerModel.anchor && asked && sameModel
    ? providerModel.anchor(asked)
    : undefined
  let boundary = asked &&
    entries.find((b) => b.entity.eid == comp(asked!, ASK)?.through)
  let asking = askingOf(entries)
  let said = lines(context(entries), asking)
  let window = anchorId
    ? said.filter((b) =>
      seqOf(b) > seqOf(asked!) ||
      // An input committed while this ask was in flight was not sent to the
      // provider, even though its sequence precedes the recorded ask result.
      (boundary && seqOf(b) > seqOf(boundary) && kindOf(b) == 'input' &&
        !b.notice)
    )
    : recent(said, using?.window)
  let effort = using?.effort ?? served?.effort
  const results = deps.resultText
    ? new Map(
      await Promise.all(
        window.filter((b) => b.result).map(async (b) =>
          [b.entity.eid, await deps.resultText!(b)] as const
        ),
      ),
    )
    : undefined
  let questions = asking && comp(asking, QUESTIONS)!.asked as Questions
  let modalities = Array.isArray(served?.modalities)
    ? served.modalities.filter((v): v is 'text' | 'image' | 'audio' =>
      v == 'text' || v == 'image' || v == 'audio'
    )
    : undefined
  let req: Request = {
    signal: deps.signal,
    model: spelled,
    ...modalities ? { modalities } : {},
    ...questions ? { questions } : {},
    effort: effort == null ? undefined : String(effort),
    instructions: deps.resolveInstructions
      ? deps.resolveInstructions(
        using?.instructions == null ? undefined : String(using.instructions),
      )
      : using?.instructions == null
      ? deps.instructions
      : String(using.instructions),
    items: project(
      window,
      toolEntities,
      anchorId ? asked!.entity.eid : undefined,
      results,
    ),
    tools: tools.map(({ name, description, parameters }) => ({
      name,
      description,
      parameters,
    })),
    anchor: anchorId,
  }
  // A provider anchor can hide a large retained history. Measure the visible
  // transcript as well, and write one summary checkpoint before asking again.
  // The next pass sees that summary plus the unsummarized suffix.
  let budget = Math.max(1, deps.contextTokens ?? 32_000) * 4
  if (
    using?.window == null && String(req.instructions ?? '').length < budget &&
    JSON.stringify(project(said, toolEntities)).length +
          String(req.instructions ?? '').length > budget
  ) {
    let historyResults = deps.resultText
      ? new Map(
        await Promise.all(
          said.filter((b) => b.result).map(async (b) =>
            [b.entity.eid, await deps.resultText!(b)] as const
          ),
        ),
      )
      : undefined
    if (
      JSON.stringify(project(said, toolEntities, undefined, historyResults))
            .length + String(req.instructions ?? '').length > budget
    ) {
      let chunk = prefix(said, budget)
      let through = chunk.at(-1)
      if (!through) return nothing
      try {
        let compacted = await providerModel({
          model: spelled,
          effort: req.effort,
          instructions: [
            req.instructions,
            'Summarize this transcript for its next model turn. Preserve the ' +
            'current goal, decisions, exact identifiers, open work, and recent ' +
            'user instructions. Do not answer the user. Return only the summary.',
          ].filter(Boolean).join('\n\n'),
          items: [{
            kind: 'user',
            text: JSON.stringify(
              project(chunk, toolEntities, undefined, historyResults),
            ),
          }],
          tools: [],
          tokens: 4096,
          signal: deps.signal,
        })
        let summary = compacted.items.filter((i) => i.kind == 'assistant')
          .map((i) => i.text).join('\n').trim()
        if (!summary) throw new ModelError('compaction', 'Empty summary')
        return append([
          line(
            {
              checkpoint: { through: through.entity.eid, seq: seqOf(through) },
              notice: {},
            },
            summary,
          ),
        ])
      } catch (e) {
        if (!(e instanceof ModelError)) deps.report?.(e, session, 'compaction')
        return append([
          e instanceof ModelError
            ? line({ [ERROR]: { code: e.code } }, e.message)
            : line({ [EXCEPTION]: {} }, String(e)),
        ])
      }
    }
  }
  let ask = line({
    [ASK]: { to: modelEid, through: newest.entity.eid },
    ...using || req.instructions
      ? {
        [USING]: {
          ...using,
          instructions: req.instructions ?? null,
        },
      }
      : {},
    ...deps.streaming ? { attempt: { state: 'inflight' } } : {},
  })
  const stream = new Map<
    string,
    {
      entry: Bundle
      writer: Awaited<ReturnType<ReturnType<typeof transient>['begin']>>
    }
  >()
  let tail = Promise.resolve(), streamFailure: unknown
  let accepting = true, checkpointAt = Date.now(), pendingDeltas = 0
  const checkpointMs = deps.checkpointMs ?? 2000
  const enqueue = (work: () => Promise<void>) => {
    tail = tail.then(work).catch((e) => {
      streamFailure ??= e
    })
  }
  if (deps.streaming) {
    // Resolve inputs before admitting the request: a local image read failure
    // must not be mistaken for an ambiguous network dispatch.
    if (deps.contextItems) {
      req.items.push(...await deps.contextItems(window, entries))
    }
    ;[ask] = await g.apply([ask], { trusted: true })
    req.onText = ({ index, id, text }) => {
      if (!accepting) return
      if (++pendingDeltas > 4096) {
        throw new Error('Streaming consumer backlog exceeds 4096 deltas')
      }
      const key = id ?? String(index)
      enqueue(async () => {
        if (!Number.isSafeInteger(index) || index < 0) {
          throw new Error('Invalid streamed item index')
        }
        let active = stream.get(key)
        if (!active) {
          let landed = await g.apply([
            {
              entity: ask.entity,
              $was: { attempt: { state: token('inflight') } },
            },
            line({
              [CONTENT]: { body: '' },
              [OUTPUT]: { source: ask.entity.eid },
            }),
          ], { trusted: true })
          let entry = landed.find((b) => b.entity.eid != ask.entity.eid)!
          active = {
            entry,
            writer: await transient(g).begin(
              entry.entity.eid,
              CONTENT,
              'body',
              entry.entity.eid,
            ),
          }
          stream.set(key, active)
        }
        pendingDeltas--
        active.writer.append(text)
        if (checkpointMs > 0 && Date.now() - checkpointAt >= checkpointMs) {
          for (const item of stream.values()) await item.writer.checkpoint()
          checkpointAt = Date.now()
        }
      })
    }
  }
  let reply: Reply
  try {
    if (!deps.streaming && deps.contextItems) {
      req.items.push(...await deps.contextItems(window, entries))
    }
    reply = await providerModel(req)
    accepting = false
    await tail
    if (streamFailure) throw streamFailure
  } catch (e) {
    accepting = false
    await tail
    const operational = e instanceof ModelError ||
      (e instanceof Error && e.name == 'AbortError')
    if (deps.streaming) {
      let failed = await finish(
        ask,
        { entity: ask.entity, attempt: { state: 'interrupted' } },
        [
          line(
            operational
              ? { [ERROR]: { code: 'interrupted' } }
              : { [EXCEPTION]: {} },
            operational ? 'Response interrupted: ' + String(e) : String(e),
          ),
        ],
      )
      if (!failed) {
        for (const active of stream.values()) active.writer.discard()
        return current()
      }
      if (!operational) deps.report?.(e, session, 'model')
      for (const active of stream.values()) {
        try {
          await active.writer.commit()
        } catch (failure) {
          active.writer.discard()
          deps.report?.(failure, session, 'stream-checkpoint')
        }
      }
      return failed
    }
    if (!operational) deps.report?.(e, session, 'model')
    return append([
      e instanceof ModelError
        ? line({ [ERROR]: { code: e.code } }, e.message)
        : line({ [EXCEPTION]: {} }, String(e)),
    ])
  }
  const finalAsk: Bundle = {
    ...ask,
    ...providerModel.mark?.(reply) ?? {},
    ...reply.usage ? { usage: reply.usage } : {},
    ...deps.streaming ? { attempt: { state: 'completed' } } : {},
  }
  let added: Bundle[] = [finalAsk]
  let textIndex = 0
  let byName = new Map(
    [...toolEntities].map(([eid, t]) => [t.name, eid] as const),
  )
  for (let item of reply.items) {
    if (item.kind == 'assistant') {
      const active = stream.get(item.id ?? String(textIndex))
      textIndex++
      added.push(
        active
          ? {
            entity: active.entry.entity,
            $was: { [CONTENT]: { body: active.writer.expected() } },
            [CONTENT]: { body: item.text },
            [OUTPUT]: { source: ask.entity.eid },
          }
          : line({
            [CONTENT]: { body: item.text },
            [OUTPUT]: { source: ask.entity.eid },
          }),
      )
    } else if (item.kind == 'call') {
      // The model's arguments are JSON text; a call's are the object it
      // spells. Text that spells no object is kept as the model wrote it, so
      // the transcript resends it verbatim, and the call is refused (`served`).
      let args = objectIn(item.args)
      added.push(line(
        {
          [CALL]: {
            to: byName.get(item.name),
            id: item.id,
            ...args ? { args } : {},
            source: ask.entity.eid,
          },
        },
        args ? undefined : item.args,
      ))
    }
  }
  // One entry per answer, said as a line too, so a person reading the
  // transcript sees what was decided and a query can match
  // `.answer.question=plan`. No later turn reads it (`lines`).
  for (let [question, a] of Object.entries(reply.answers ?? {})) {
    let { type: _, ...answer } = a
    added.push(line({
      [ANSWER]: { question, ...answer },
      [OUTPUT]: { source: ask.entity.eid },
    }, saying(question, a)))
  }
  for (let artifact of reply.artifacts ?? []) {
    let eid = artifact.address
    added.push({
      entity: { eid },
      artifact: {
        address: artifact.address,
        media_type: artifact.media_type,
        size: artifact.size,
      },
    })
    added.push(line({
      attachment: {
        artifact: eid,
        call: artifact.call,
        ...artifact.revised_prompt
          ? { revised_prompt: artifact.revised_prompt }
          : {},
      },
      [OUTPUT]: { source: ask.entity.eid },
      [CONTENT]: {
        body: 'Generated media: ' + eid + ' (' + artifact.media_type + ', ' +
          artifact.size + ' bytes)',
      },
    }))
  }
  try {
    if (!deps.streaming) return await append(added)
    if (
      [...stream.values()].some((active) =>
        !added.some((b) => b.entity.eid == active.entry.entity.eid)
      )
    ) {
      let omitted = await finish(
        ask,
        { entity: ask.entity, attempt: { state: 'interrupted' } },
        [
          line(
            { [EXCEPTION]: {} },
            'Completed reply omitted a streamed text item; retained partial output',
          ),
        ],
      )
      if (!omitted) return current()
      for (const active of stream.values()) await active.writer.commit()
      return omitted
    }
    return await finish(ask, finalAsk, added.slice(1)) ?? await current()
  } catch (e) {
    if (!deps.streaming) throw e
    return await finish(
      ask,
      { entity: ask.entity, attempt: { state: 'interrupted' } },
      [
        line(
          { [EXCEPTION]: {} },
          'Could not finalize provider reply: ' + String(e),
        ),
      ],
    ) ?? await current()
  } finally {
    for (const active of stream.values()) active.writer.discard()
  }
}
