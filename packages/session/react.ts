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
  ordered,
  seqOf,
  statusOf,
  textOf,
  type TranscriptStatus,
  usingBefore,
} from './status.ts'

/** A tool the model may call: its declaration, and how to run it. */
export type Tool = Declared & {
  run: (args: Record<string, unknown>) => Promise<string> | string
}

/** What `react` is handed beside the graph. */
export type Deps = {
  model: Model
  tools: Tool[]
  instructions?: string
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

/** The model's view of a window of the transcript: inputs as user turns, what
 * the model said as assistant turns, tool calls and results as the pair a
 * model expects. Ask entries are our record, not the model's; a tool call the
 * anchored reply itself asked for is already in the provider's state, so only
 * its result travels. */
export let project = (
  entries: Bundle[],
  tools: Map<Eid, Declared>,
  anchor?: Eid,
): Item[] => {
  let out: Item[] = []
  for (let b of entries) {
    let kind = kindOf(b)
    let c = comp(b, CALL)
    if (kind == 'input') out.push({ kind: 'user', text: textOf(b) })
    else if (kind == 'output') out.push({ kind: 'assistant', text: textOf(b) })
    else if (kind == 'call' && c?.source != anchor) {
      out.push({
        kind: 'call',
        id: String(c!.id),
        name: tools.get(String(c!.to))?.name ?? 'tool',
        args: String(c!.args ?? '{}'),
      })
    } else if (kind == 'result') {
      let call = entries.find((e) => e.entity.eid == comp(b, RESULT)?.call)
      out.push({
        kind: 'result',
        id: String(comp(call!, CALL)?.id ?? ''),
        output: textOf(b),
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
  let own = entries.filter((b) => comp(b, ENTRY)?.session == session)
  let next = (own.length ? seqOf(own.at(-1)!) : seqOf(newest)) + 1
  let line = (extra: Record<string, Comp>, body?: string): Bundle => ({
    entity: { eid: mint() },
    [ENTRY]: { session, seq: next++ },
    ...body == null ? {} : { [CONTENT]: { body } },
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
  let toolEntities = new Map<Eid, Tool>()
  for (let b of await g.read(`.${TOOL}`)) {
    let t = deps.tools.find((t) => t.name == comp(b, TOOL)?.name)
    if (t) toolEntities.set(b.entity.eid, t)
  }

  // Open tool calls: perform every one the newest ask asked for that has no
  // result yet, in one batch, so the model is never asked with a call it made
  // still unanswered (the provider refuses that). A tool that throws is an
  // exception and a result saying so, so the model hears what happened and
  // the session goes on.
  let asked = entries.filter((b) => kindOf(b) == 'ask').at(-1)
  let answered = new Set(
    entries.filter((b) => kindOf(b) == 'result')
      .map((b) => String(comp(b, RESULT)?.call)),
  )
  let open = asked
    ? entries.filter((b) =>
      comp(b, CALL)?.source == asked.entity.eid &&
      !answered.has(b.entity.eid)
    )
    : []
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
      try {
        out = tool
          ? String(await tool.run(args))
          : `no such tool: ${String(c.to)}`
      } catch (e) {
        out = `tool failed: ${String(e)}`
        added.push(line({ [EXCEPTION]: {} }, String(e)))
      }
      added.push(line({ [RESULT]: { call: pending.entity.eid } }, out))
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
  let anchorId = deps.model.anchor && asked
    ? deps.model.anchor(asked)
    : undefined
  let window = anchorId
    ? entries.filter((b) => seqOf(b) > seqOf(asked!))
    : entries
  let effort = using?.effort ?? served?.effort
  let req: Request = {
    model: modelName,
    effort: effort == null ? undefined : String(effort),
    instructions: deps.instructions,
    items: project(
      window,
      toolEntities,
      anchorId ? asked!.entity.eid : undefined,
    ),
    tools: deps.tools.map(({ name, description, parameters }) => ({
      name,
      description,
      parameters,
    })),
    anchor: anchorId,
  }
  let reply: Reply
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
  // The ask is recorded once the model answered: an ask that never went out
  // takes no seq, so the error or exception that stands for it does. What the
  // provider keeps about the reply rides beside it as the provider's own comp.
  let ask = line({
    [ASK]: { to: modelEid, through: newest.entity.eid },
    ...using ? { [USING]: using } : {},
    ...deps.model.mark?.(reply) ?? {},
  })
  let added: Bundle[] = [ask]
  let byName = new Map(
    [...toolEntities].map(([eid, t]) => [t.name, eid] as const),
  )
  for (let item of reply.items) {
    if (item.kind == 'assistant') {
      added.push(
        line({ [CONTENT]: { body: item.text, source: ask.entity.eid } }),
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
