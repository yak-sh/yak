// The daemon's one step. `react(graph, session)` reads the newest entry of a
// transcript and does the one next thing it says: a pending input or result
// asks the model; an open tool call is performed; an error under the retry
// bound asks the model again; everything else is nothing. It appends what
// happened as entries and returns, so a loop over it is a session and a
// `created(entry)` effect over it is the daemon.
//
// It owns no transport and no tools: it is handed a `ModelCall` and a table of
// tools, so the same code runs over a Responses transport in effectsd, over a
// fake in a test, and inside a Store on Cloudflare. It imports no platform API.
//
// A fork's transcript is the parent's entries up to the anchor plus its own.
// The prefix a model call is asked with is the entries after the newest model
// call that has a `response_id` — sent as `previous_response_id` plus only what
// followed — and the whole transcript when there is none. That one rule is
// what makes a fork's first call cheap and a rewind possible: the anchor is
// the parent's last response, and only the fork's new input travels.

import type { Bundle, Comp, Eid, Graph } from '@yaks/graph'
import {
  CALL,
  ENTRY,
  ERROR,
  EXCEPTION,
  FORK,
  MODEL,
  OUTPUT,
  RESULT,
  TOOL,
  USING,
} from './native.ts'
import {
  kindOf,
  ordered,
  seqOf,
  statusOf,
  type TranscriptStatus,
  usingBefore,
} from './status.ts'

/** A tool the model may call: its declaration, and how to run it. */
export type Tool = {
  name: string
  description: string
  parameters: Record<string, unknown>
  run: (args: Record<string, unknown>) => Promise<string> | string
}

/** One item a model returned. */
export type ModelItem =
  | { type: 'message'; text: string }
  | { type: 'function_call'; id: string; name: string; arguments: string }

/** What a model is asked: the Responses shape, provider-neutral. */
export type ModelRequest = {
  model: string
  effort?: string
  instructions?: string
  input: unknown[]
  tools: { name: string; description: string; parameters: unknown }[]
  previous_response_id?: string
}

/** What a model answered: its anchor, the model that served, the items. */
export type ModelReply = { id: string; model: string; items: ModelItem[] }

/** The transport: one request in, one reply out. Throwing is an `error` entry
 * (a fault the transport named) or an `exception` (anything else). */
export type ModelCall = (req: ModelRequest) => Promise<ModelReply>

/** A transport fault the daemon expects — the world said no. Anything else a
 * transport throws is an exception. */
export class ModelError extends Error {
  code: string
  constructor(code: string, message = code) {
    super(message)
    this.name = 'ModelError'
    this.code = code
  }
}

/** What `react` is handed beside the graph. */
export type Deps = {
  model: ModelCall
  tools: Tool[]
  instructions?: string
  now?: () => string
  mint?: () => Eid
}

/** What one step did. */
export type Step = {
  did: 'asked' | 'ran' | 'nothing'
  status: TranscriptStatus
  /** the entries appended, in order */
  added: Bundle[]
}

let text = (b: Bundle) => String((b[ENTRY] as Comp)?.text ?? '')
let comp = (b: Bundle, name: string) => b[name] as Comp | undefined

/** A transcript's entries: a fork's prefix from its parent up to the anchor,
 * then its own, in order. */
export let transcript = async (g: Graph, session: Eid): Promise<Bundle[]> => {
  let own = await g.read(`.${ENTRY}.session=${session}`)
  let [self] = await g.storage.tx((tx) => tx.get([session]))
  let from = comp(self, FORK)?.from
  if (!from) return ordered(own)
  let [anchor] = await g.storage.tx((tx) => tx.get([String(from)]))
  let parent = comp(anchor, ENTRY)
  if (!parent) return ordered(own)
  let inherited = await transcript(g, String(parent.session))
  return [
    ...inherited.filter((b) => seqOf(b) <= seqOf(anchor)),
    ...ordered(own),
  ]
}

// The model's view of a window of the transcript: inputs as user turns, what
// the model said as assistant turns, tool calls and results as the function
// pair the API expects. Model call entries are our record, not the model's.
let project = (
  entries: Bundle[],
  tools: Map<Eid, Tool>,
  anchor?: Eid,
): unknown[] => {
  let out: unknown[] = []
  for (let b of entries) {
    let kind = kindOf(b)
    // a tool call the anchored response itself asked for is already in the
    // provider's state; only its output travels
    if (kind == 'call' && comp(b, CALL)?.source == anchor) continue
    if (kind == 'input') {
      out.push({
        role: 'user',
        content: [{ type: 'input_text', text: text(b) }],
      })
    } else if (kind == 'output') {
      out.push({
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: text(b) }],
      })
    } else if (kind == 'call' && comp(b, CALL)?.source != null) {
      let c = comp(b, CALL)!
      out.push({
        type: 'function_call',
        call_id: String(c.id),
        name: tools.get(String(c.to))?.name ?? 'tool',
        arguments: String(c.args ?? '{}'),
      })
    } else if (kind == 'result') {
      let call = entries.find((e) => e.entity.eid == comp(b, RESULT)?.call)
      out.push({
        type: 'function_call_output',
        call_id: String(comp(call!, CALL)?.id ?? ''),
        output: text(b),
      })
    }
  }
  return out
}

let isModelCall = (b: Bundle) =>
  kindOf(b) == 'call' && comp(b, CALL)?.source == null

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
  let own = entries.filter((b) => comp(b, ENTRY)?.session == session)
  let next = (own.length ? seqOf(own.at(-1)!) : seqOf(newest)) + 1
  let line = (extra: Record<string, Comp>, body = ''): Bundle => ({
    entity: { eid: mint() },
    [ENTRY]: { session, seq: next++, text: body },
    ...extra,
  })
  let append = async (added: Bundle[]): Promise<Step> => {
    await g.apply(added, { trusted: true })
    return {
      did: 'asked',
      status: statusOf([...entries, ...added]),
      added,
    }
  }
  let byEid = new Map(
    (await g.read(`.${TOOL}`)).map((b) => [b.entity.eid, b] as const),
  )
  let toolEntities = new Map<Eid, Tool>()
  for (let [eid, b] of byEid) {
    let t = deps.tools.find((t) => t.name == comp(b, TOOL)?.name)
    if (t) toolEntities.set(eid, t)
  }

  // An open tool call: perform it. A tool that throws is an exception and a
  // result saying so, so the model hears what happened and the session goes on.
  if (status == 'running' && !isModelCall(newest)) {
    let c = comp(newest, CALL)!
    let tool = toolEntities.get(String(c.to))
    let args: Record<string, unknown> = {}
    try {
      args = JSON.parse(String(c.args ?? '{}'))
    } catch { /* malformed arguments are the tool's problem to report */ }
    let added: Bundle[] = []
    let out: string
    try {
      out = tool
        ? String(await tool.run(args))
        : `no such tool: ${String(c.to)}`
    } catch (e) {
      out = `tool failed: ${String(e)}`
      added.push(line({ [EXCEPTION]: {} }, String(e)))
    }
    added.push(line({ [RESULT]: { call: newest.entity.eid } }, out))
    let step = await append(added)
    return { ...step, did: 'ran' }
  }
  if (status == 'running') return nothing

  // Pending, or an error under the bound: ask the model. The anchor is the
  // newest model call with a response id; only what followed it travels.
  let using = usingBefore(entries)
  let modelEid = using?.model == null ? undefined : String(using.model)
  let [modelEntity] = modelEid
    ? await g.storage.tx((tx) => tx.get([modelEid]))
    : []
  let modelName = String(comp(modelEntity ?? {} as Bundle, MODEL)?.name ?? '')
  if (!modelName) {
    return append([
      line({ [ERROR]: { code: 'no_model' } }, 'no model in force'),
    ])
  }
  let anchor = entries.filter((b) =>
    isModelCall(b) && comp(b, CALL)?.response_id
  )
    .at(-1)
  let window = anchor
    ? entries.filter((b) => seqOf(b) > seqOf(anchor))
    : entries
  let call = line({
    [CALL]: { to: modelEid, through: newest.entity.eid },
    ...using ? { [USING]: using } : {},
  })
  let req: ModelRequest = {
    model: modelName,
    effort: using?.effort == null ? undefined : String(using.effort),
    instructions: deps.instructions,
    input: project(window, toolEntities, anchor?.entity.eid),
    tools: deps.tools.map(({ name, description, parameters }) => ({
      name,
      description,
      parameters,
    })),
    previous_response_id: anchor
      ? String(comp(anchor, CALL)!.response_id)
      : undefined,
  }
  let reply: ModelReply
  try {
    reply = await deps.model(req)
  } catch (e) {
    // The bound is the status rule's: RETRIES consecutive errors read `failed`,
    // and a failed transcript is left alone at the top of the next step.
    return append([
      e instanceof ModelError
        ? line({ [ERROR]: { code: e.code } }, e.message)
        : line({ [EXCEPTION]: {} }, String(e)),
    ])
  }
  ;(call[CALL] as Comp).response_id = reply.id
  let added: Bundle[] = [call]
  let byName = new Map(
    [...toolEntities].map(([eid, t]) => [t.name, eid] as const),
  )
  for (let item of reply.items) {
    if (item.type == 'message') {
      added.push(line({ [OUTPUT]: { source: call.entity.eid } }, item.text))
    } else {
      added.push(line({
        [CALL]: {
          to: byName.get(item.name),
          id: item.id,
          args: item.arguments,
          source: call.entity.eid,
        },
      }))
    }
  }
  return append(added)
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
