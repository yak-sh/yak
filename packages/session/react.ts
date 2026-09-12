import { transient } from '@yaks/graph'
// The daemon's one step. `react(graph, session)` reads the newest entry of a
// transcript and does the one next thing it says: a pending input or result
// asks the model; an open tool call is performed; an error under the retry
// bound asks the model again; everything else is nothing. It appends what
// happened as entries and returns, so a loop over it is a session and a
// `created(entry)` effect over it is the daemon (./daemon.ts).
//
// It owns no transport and no tools: it is handed a @yaks/model `Model` and a
// table of tools, so the same code runs over @yaks/openai in a CLI, over a
// fake in a test, and inside a Store on Cloudflare. It imports no platform API.
//
// A fork's transcript is the parent's entries up to the anchor plus its own.
// When the model can continue from a kept reply (`model.anchor` answers for
// the newest ask), the model is asked with that anchor plus only what
// followed; otherwise the whole transcript travels every time. That one rule is
// what makes a fork's first ask cheap where the provider allows it: the anchor
// is the parent's last reply, and only the fork's new input travels. What the
// provider keeps about an ask is its own comp on the ask entry (`model.mark`),
// which is why the question is the model's to answer.

import type { Bundle, Comp, Eid, Graph } from '@yaks/graph'
import {
  type Item,
  MODEL,
  type Model,
  ModelError,
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

/** The caller, supplied by react rather than by model arguments. */
export type ToolContext = { session: Eid; call: Bundle; entries: Bundle[] }

/** A refused tool invocation: expected, recorded as an error and a result. */
export class ToolError extends Error {
  constructor(public code: string, message: string) {
    super(message)
  }
}

export { UnknownSession } from './unknown.ts'
import { UnknownSession } from './unknown.ts'
import { took } from './timing.ts'

/** A tool the model may call: its declaration, and how to run it. */
export type Tool = Declared & {
  run: (
    args: Record<string, unknown>,
    ctx?: ToolContext,
  ) => Promise<string> | string
}

/** What `react` is handed beside the graph. */
export type Deps = {
  /** Experimental durable request admission with transient text. */
  streaming?: boolean
  /** Minimum interval between durable stream checkpoints; zero disables. */
  checkpointMs?: number
  model: Model
  tools: Tool[]
  /** Resolve a stable tool registry for one execution step. */
  toolSnapshot?: (phase: 'ask' | 'call') => Promise<Tool[]>
  signal?: AbortSignal
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

/** A transcript's entries: a fork's prefix from its parent up to the anchor,
 * then its own, in order. */
export let transcript = async (g: Graph, session: Eid): Promise<Bundle[]> => {
  let [self] = await g.storage.tx((tx) => tx.get([session]))
  if (!self?.session) throw new UnknownSession(session)
  let own = await g.read(`.${ENTRY}.session=${session}`)
  let from = comp(self, FORK)?.from
  if (!from) return ordered(own)
  let [anchor] = await g.storage.tx((tx) => tx.get([String(from)]))
  let parent = anchor && comp(anchor, ENTRY)
  if (!parent) return ordered(own)
  let inherited = await transcript(g, String(parent.session))
  return [
    ...inherited.filter((b) => seqOf(b) <= seqOf(anchor)),
    ...ordered(own),
  ]
}

/** The model's view of a window of the transcript: inputs as user turns, what
 * the model said as assistant turns, tool calls and results as the pair a
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
    if (b.prompt) out.push({ kind: 'instruction', text: textOf(b) })
    else if (kind == 'input') out.push({ kind: 'user', text: textOf(b) })
    else if (kind == 'output') out.push({ kind: 'assistant', text: textOf(b) })
    else if (kind == 'call' && c?.source != anchor) {
      out.push({
        kind: 'call',
        id: String(c!.id),
        name: tools.get(String(c!.to))?.name ?? 'tool',
        args: String(c!.args ?? '{}'),
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
 * One step of the daemon over one transcript. Reads the newest entry, does the
 * one thing it asks for, appends the entries that record it, and says what it
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
  let line = (extra: Record<string, Comp>, body?: string): Bundle => ({
    entity: { eid: mint() },
    [ENTRY]: { session },
    ...body == null ? {} : { [CONTENT]: { body } },
    ...extra,
  })
  let append = async (added: Bundle[]): Promise<Step> => {
    added = await g.apply(added, { trusted: true })
    return {
      did: 'asked',
      status: statusOf(await transcript(g, session)),
      added,
    }
  }
  const unfinished = entries.find((b) =>
    (b.attempt as Comp | undefined)?.state == 'inflight'
  )
  if (unfinished) {
    // A live invocation is serialized by the daemon. Re-entering an unfinished
    // attempt means interrupted execution, not permission to repeat a request.
    return append([
      { entity: unfinished.entity, attempt: { state: 'interrupted' } },
      line(
        { [ERROR]: { code: 'interrupted' } },
        'Response interrupted.',
      ),
    ])
  }
  const tools = deps.toolSnapshot
    ? await deps.toolSnapshot(openCalls(entries).length ? 'call' : 'ask')
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
  // the session goes on. This is the SAME set statusOf reads as `running`, so
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
    let added: Bundle[] = []
    for (let pending of open) {
      let c = comp(pending, CALL)!
      let tool = toolEntities.get(String(c.to))
      let args: Record<string, unknown> = {}
      try {
        args = JSON.parse(String(c.args ?? '{}'))
      } catch { /* malformed arguments are the tool's problem to report */ }
      let out: string
      let started = performance.now()
      try {
        out = tool
          ? String(await tool.run(args, { session, call: pending, entries }))
          : `no such tool: ${String(c.to)}`
      } catch (e) {
        if (!(e instanceof ToolError)) deps.report?.(e, session, 'tool')
        out = `tool failed: ${String(e)}`
        added.push(
          line(
            e instanceof ToolError
              ? { [ERROR]: { code: e.code } }
              : { [EXCEPTION]: {} },
            String(e),
          ),
        )
      }
      added.push(
        line({
          [RESULT]: {
            call: pending.entity.eid,
            ms: Math.round(performance.now() - started),
          },
        }, out),
      )
    }
    let step = await append(added)
    return { ...step, did: 'ran' }
  }
  if (status == 'running') return nothing

  // Pending, or an error under the bound: ask the model. The anchor is the
  // newest ask the model can continue from; only what followed it travels.
  let using = usingBefore(entries)
  let modelEid = using?.model == null ? undefined : String(using.model)
  let [modelEntity] = modelEid
    ? await g.storage.tx((tx) => tx.get([modelEid]))
    : []
  let served = comp(modelEntity ?? {} as Bundle, MODEL)
  let modelName = String(served?.name ?? '')
  if (!modelName) {
    return append([
      line({ [ERROR]: { code: 'no_model' } }, 'no model in force'),
    ])
  }
  // Only completed responses can supply provider continuation state. A partial
  // response remains ordinary visible history after the last completed anchor.
  asked = newestAsk(
    entries.filter((b) =>
      !b.attempt || (b.attempt as Comp).state == 'completed'
    ),
  )
  let anchorId = deps.model.anchor && asked
    ? deps.model.anchor(asked)
    : undefined
  let boundary = asked &&
    entries.find((b) => b.entity.eid == comp(asked!, ASK)?.through)
  let window = anchorId
    ? entries.filter((b) =>
      seqOf(b) > seqOf(asked!) ||
      // An input committed while this ask was in flight was not sent to the
      // provider, even though its sequence precedes the recorded ask result.
      (boundary && seqOf(b) > seqOf(boundary) && kindOf(b) == 'input' &&
        !b.notice)
    )
    : entries
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
  let req: Request = {
    signal: deps.signal,
    model: modelName,
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
          const [entry] = await g.apply([
            line({ [CONTENT]: { body: '', source: ask.entity.eid } }),
          ], { trusted: true })
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
    reply = await deps.model(req)
    accepting = false
    await tail
    if (streamFailure) throw streamFailure
  } catch (e) {
    accepting = false
    await tail
    for (const active of stream.values()) {
      try {
        await active.writer.commit()
      } catch (failure) {
        active.writer.discard()
        deps.report?.(failure, session, 'stream-checkpoint')
      }
    }
    const operational = e instanceof ModelError ||
      (e instanceof Error && e.name == 'AbortError')
    if (!operational) deps.report?.(e, session, 'model')
    if (deps.streaming) {
      return append([
        { entity: ask.entity, attempt: { state: 'interrupted' } },
        line(
          operational
            ? { [ERROR]: { code: 'interrupted' } }
            : { [EXCEPTION]: {} },
          operational ? 'Response interrupted: ' + String(e) : String(e),
        ),
      ])
    }
    return append([
      e instanceof ModelError
        ? line({ [ERROR]: { code: e.code } }, e.message)
        : line({ [EXCEPTION]: {} }, String(e)),
    ])
  }
  const finalAsk: Bundle = {
    ...ask,
    ...deps.model.mark?.(reply) ?? {},
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
            [CONTENT]: { body: item.text, source: ask.entity.eid },
          }
          : line({ [CONTENT]: { body: item.text, source: ask.entity.eid } }),
      )
    } else if (item.kind == 'call') {
      added.push(line({
        [CALL]: {
          to: byName.get(item.name),
          id: item.id,
          args: item.args,
          source: ask.entity.eid,
        },
      }))
    }
  }
  for (let artifact of reply.artifacts ?? []) {
    let eid = 'artifact:' + artifact.address
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
      [CONTENT]: {
        source: ask.entity.eid,
        body: 'Generated image: ' + eid + ' (' + artifact.media_type + ', ' +
          artifact.size + ' bytes)',
      },
    }))
  }
  if (
    [...stream.values()].some((active) =>
      !added.some((b) => b.entity.eid == active.entry.entity.eid)
    )
  ) {
    for (const active of stream.values()) await active.writer.commit()
    return append([
      { entity: ask.entity, attempt: { state: 'interrupted' } },
      line(
        { [EXCEPTION]: {} },
        'Completed reply omitted a streamed text item; retained partial output',
      ),
    ])
  }
  try {
    return await append(added)
  } catch (e) {
    if (!deps.streaming) throw e
    return append([
      { entity: ask.entity, attempt: { state: 'interrupted' } },
      line(
        { [EXCEPTION]: {} },
        'Could not finalize provider reply: ' + String(e),
      ),
    ])
  } finally {
    for (const active of stream.values()) active.writer.discard()
  }
}

/** Run `react` until the transcript settles, stops, or fails, or `cap` steps
 * pass; each step is reported to `each` as it lands. */
export let settle = async (
  g: Graph,
  session: Eid,
  deps: Deps,
  cap = 20,
  each: (step: Step) => void = () => {},
): Promise<TranscriptStatus> => {
  let status: TranscriptStatus = 'empty'
  for (let i = 0; i < cap; i++) {
    let step = await react(g, session, deps)
    each(step)
    status = step.status
    if (step.did == 'nothing') break
  }
  return status
}
