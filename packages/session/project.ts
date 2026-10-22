// The model's view of a transcript: the items a request carries, made from
// entries. A step projects the whole transcript it sends, so this runs once
// per request over every line a long session holds; it is linear in the
// transcript, never a pass over it per ask or per result.

import type { Bundle, Comp, Eid } from '@yaks/graph'
import type { Item, Tool as Declared } from '@yaks/model'
import { ASK, CALL, OUTPUT, RESULT } from './native.ts'
import { kindOf, ordered, seqOf, textOf } from './state.ts'
import { items as taskItems, type Tasks } from './task-context.ts'
import { took } from './timing.ts'

let comp = (b: Bundle | undefined, name: string) =>
  b?.[name] as Comp | undefined

/** What a background call (`tool_async`) answers while it runs: its interim
 * result, paired with the call like any other, and saying what it means where
 * the model reads it. A request derives it from the call; a call that outlasts
 * its patience is also given it as an entry (`tool_progress`, ./react.ts), the
 * new line that lets the model take a turn while it runs. The final arrives
 * later, naming its call ({@link project}). */
export let PENDING = 'Pending; its result will follow.'

// The call an entry answers: a final's or a Pending's.
let answers = (b: Bundle) =>
  comp(b, RESULT)?.call ?? comp(b, 'tool_progress')?.call

let clip = (text: string, max = 120) =>
  text.length > max ? text.slice(0, max) + '…' : text

// The ask an entry answers: an output's or a call's source, or for a call's
// progress, the source of that call.
let sourceOf = (b: Bundle, byId: Map<Eid, Bundle>): unknown =>
  comp(b, OUTPUT)?.source ?? comp(b, CALL)?.source ??
    comp(byId.get(String(comp(b, 'tool_progress')?.call)), CALL)?.source

// The index of the first of ascending `seqs` at or past `seq`.
let reaching = (seqs: number[], seq: number) => {
  let lo = 0, hi = seqs.length
  while (lo < hi) {
    let mid = (lo + hi) >> 1
    if (seqs[mid] < seq) lo = mid + 1
    else hi = mid
  }
  return lo
}

/**
 * Each reply moved to just after the line its ask was sent through
 * (`ask.through`), asks taken oldest first; a reply whose boundary is not
 * among `lines` stays where it is. A reply is its entries in their order in
 * `lines`. The list is linked by index, so every move costs the reply's own
 * length.
 *
 * ```ts
 * import { replied } from './project.ts'
 * let e = (eid: string, more = {}) => ({ entity: { eid }, ...more })
 * let lines = [
 *   e('in'),
 *   e('late'), // landed while the ask was answered
 *   e('out', { output: { source: 'ask' } }),
 * ]
 * let asks = [e('ask', { ask: { through: 'in' } })]
 * replied(asks, lines, new Map()).map((b) => b.entity.eid)
 * // -> ['in', 'out', 'late']
 * ```
 */
export let replied = (
  asks: Bundle[],
  lines: Bundle[],
  byId: Map<Eid, Bundle>,
): Bundle[] => {
  let n = lines.length
  // Node n is the head; next and prev make a ring through it.
  let next = new Int32Array(n + 1), prev = new Int32Array(n + 1)
  for (let i = 0; i <= n; i++) {
    next[i] = (i + 1) % (n + 1)
    prev[i] = (i + n) % (n + 1)
  }
  let at = new Map<Eid, number>()
  let replies = new Map<string, number[]>()
  lines.forEach((b, i) => {
    if (!at.has(b.entity.eid)) at.set(b.entity.eid, i)
    let source = sourceOf(b, byId)
    if (source == null) return
    let reply = replies.get(String(source))
    if (reply) reply.push(i)
    else replies.set(String(source), [i])
  })
  for (let ask of asks) {
    let reply = replies.get(ask.entity.eid)
    let boundary = at.get(String(comp(ask, ASK)?.through))
    if (!reply || boundary == null || reply.includes(boundary)) continue
    for (let i of reply) {
      next[prev[i]] = next[i]
      prev[next[i]] = prev[i]
    }
    let cursor = boundary
    for (let i of reply) {
      next[i] = next[cursor]
      prev[i] = cursor
      prev[next[cursor]] = i
      next[cursor] = i
      cursor = i
    }
  }
  let out: Bundle[] = []
  for (let i = next[n]; i != n; i = next[i]) out.push(lines[i])
  return out
}

/** The model's view of a window of the transcript: inputs as user turns, what
 * the model returned as assistant turns, tool calls and results as the pair a
 * model expects. The full transcript resolves a result's call even when that
 * call is outside the window. Ask entries are our record, not the model's; a
 * tool call the anchored reply itself asked for is already in the provider's
 * state, so only its result travels.
 *
 * Each call's answer (its Pending where a request sent one, else its final)
 * follows the reply's last call, in the order of the calls, whatever order
 * they landed in: many models pair a result with its call by position, never
 * by id (GLM's chat template renders `<tool_response>` blocks in order and
 * no ids). A final whose Pending a request already sent stays where it
 * landed, and names its call by tool, id and arguments.
 *
 * ```ts
 * import { project } from './project.ts'
 * let n = 0
 * let e = (comps: Record<string, unknown>) =>
 *   ({ entity: { eid: `e${++n}` }, entry: { session: 's', seq: n }, ...comps })
 * let ask = (through: string) => e({ ask: { through } })
 * let call = (id: string) =>
 *   e({ call: { to: 'echo', id, args: { id }, source: 'e2' }, tool_async: {} })
 * let tools = new Map([['echo', { name: 'echo', parameters: {} }]])
 * let entries = [
 *   e({ content: { body: 'go' } }), ask('e1'), call('a'), call('b'),
 *   e({ result: { call: 'e4' }, content: { body: 'B' } }), // landed first
 *   ask('e5'), // sent b's final and a's Pending
 *   e({ result: { call: 'e3' }, content: { body: 'A' } }),
 * ]
 * project(entries, entries, tools).map((i) =>
 *   i.kind == 'call' ? i.id : i.kind == 'result' ? i.output : i.text
 * )
 * // -> ['go', 'a', 'b', 'Pending; its result will follow.', 'B',
 * //     'The pending echo call a {"id":"a"} finished:\nA']
 * ```
 */
export let project = (
  transcript: Bundle[],
  window: Bundle[],
  tools: Map<Eid, Declared>,
  opts: {
    anchor?: Eid
    results?: Map<Eid, string>
    media?: Map<Eid, Item[]>
    history?: boolean
    /** Each input's prose as the model reads it, rendered for this
     * transcript (react's `Deps.inputText`). */
    inputText?: (entry: Bundle) => string
    /** Strict routes accept one tool output; append later updates as user text. */
    resultUpdatesAsUser?: boolean
  } = {},
): Item[] => {
  let out: Item[] = []
  let byId = new Map(transcript.map((b) => [b.entity.eid, b]))
  let asks = ordered(transcript).filter((b) => b.ask)
  // A tool can finish (or a person steer) while the provider is answering.
  // Those entries were not in that request. Keep its response immediately
  // after its frozen boundary, then append the unsent updates. Never move or
  // replace a previously submitted running result: the next full-context
  // request must extend the previous request + response byte-for-byte.
  let bounds = asks.map((ask) =>
    seqOf(byId.get(String(comp(ask, ASK)?.through)) ?? ask)
  ).sort((a, b) => a - b)
  let finals = new Set(
    window.flatMap((b) => b.result ? [String(comp(b, RESULT)?.call)] : []),
  )
  // Each call's final, and the seqs of its Pending entries: one written when
  // it outlasted its patience, or, in older transcripts, beside every
  // background call.
  let landed = new Map<string, number>()
  let progress = new Map<string, number[]>()
  for (let b of transcript) {
    if (b.result) landed.set(String(comp(b, RESULT)?.call), seqOf(b))
    let call = comp(b, 'tool_progress')?.call
    if (call == null) continue
    let seqs = progress.get(String(call))
    if (seqs) seqs.push(seqOf(b))
    else progress.set(String(call), [seqOf(b)])
  }
  // A fast tool needs only its final answer. A request sent a Pending when its
  // boundary reached the Pending but not yet its final; one that reached both
  // sent the final alone. Keep a sent Pending: that immutable prefix cannot be
  // rewritten afterwards, and a Pending no request sent is never sent late.
  // The first boundary at or past the Pending decides it. A background call's
  // Pending stands at the call, and at each Pending entry it has.
  let sent = (call: string, seq: number) =>
    (bounds[reaching(bounds, seq)] ?? Infinity) <
      (landed.get(call) ?? Infinity)
  let pendings = (call: string): number[] => {
    let b = byId.get(call)
    return [...progress.get(call) ?? [], ...b?.tool_async ? [seqOf(b)] : []]
  }
  let logical = replied(
    asks,
    window.filter((b) => {
      let call = comp(b, 'tool_progress')?.call
      return call == null || sent(String(call), seqOf(b)) ||
        !finals.has(String(call))
    }),
    byId,
  )
  // A final that follows a Pending some request sent: the call was answered.
  let late = (b: Bundle, call: string) =>
    !!b.result &&
    pendings(call).some((seq) => seq < seqOf(b) && sent(call, seq))
  // A background call nothing in the window answers: its derived Pending
  // travels where a request sent it, or while its final has not landed.
  let pending = (call: Bundle) =>
    !!call.tool_async &&
    (sent(call.entity.eid, seqOf(call)) || !finals.has(call.entity.eid))
  let spelled = (call: Bundle) => {
    let c = comp(call, CALL)!
    return {
      id: String(c.id ?? ''),
      name: tools.get(String(c.to))?.name ?? 'tool',
      args: c.args == null ? textOf(call) || '{}' : JSON.stringify(c.args),
    }
  }
  // Each call's answer, and the calls of each reply, in order: an anchored
  // reply's calls are the provider's already, yet their answers travel.
  let answer = new Map<string, Bundle>()
  let replies = new Map<string, Bundle[]>()
  for (let b of logical) {
    let call = answers(b)
    if (call != null && !late(b, String(call)) && !answer.has(String(call))) {
      answer.set(String(call), b)
    }
    let c = comp(b, CALL)
    if (kindOf(b) != 'call') continue
    let reply = replies.get(String(c?.source))
    if (reply) reply.push(b)
    else replies.set(String(c?.source), [b])
  }
  let index = new Map(logical.map((b, at) => [b, at]))
  let taken = new Set<Bundle>()
  let emit = (b: Bundle) => {
    taken.add(b)
    let kind = kindOf(b)
    let c = comp(b, CALL)
    if (b.prompt || b.checkpoint || b.task_context) {
      if (b.checkpoint && !opts.history) {
        out.push(
          ...taskItems(
            (b.checkpoint as Comp).tasks as Tasks ??
              {},
          ),
        )
      }
      out.push({ kind: 'instruction', text: textOf(b) })
    } else if (kind == 'input') {
      out.push({
        kind: 'user',
        text: opts.inputText?.(b) ?? textOf(b),
      })
    } else if (kind == 'output') {
      out.push({ kind: 'assistant', text: textOf(b) })
    } else if (kind == 'call' && c?.source != opts.anchor) {
      out.push({ kind: 'call', ...spelled(b) })
    } else if (kind == 'result') {
      let eid = String(answers(b))
      let call = byId.get(eid)
      if (!call?.call) {
        throw new Error(
          `Result ${b.entity.eid} references missing call ${eid}`,
        )
      }
      let text = opts.results?.get(b.entity.eid) ?? textOf(b)
      let ms = comp(b, RESULT)?.ms
      const output = typeof ms == 'number' ? took(text, ms) : text
      let { id, name, args } = spelled(call)
      if (late(b, eid)) {
        // Strict routes take one tool output per call; the rest take it again.
        let named = `The pending ${name} call ${id} ${clip(args)} finished:\n` +
          output
        out.push(
          opts.resultUpdatesAsUser
            ? { kind: 'user', text: named }
            : { kind: 'result', id, output: named },
        )
      } else out.push({ kind: 'result', id, output })
    }
    out.push(...opts.media?.get(b.entity.eid) ?? [])
  }
  logical.forEach((b, at) => {
    if (taken.has(b)) return
    emit(b)
    let reply = replies.get(String(comp(b, CALL)?.source))
    if (reply?.at(-1) != b) return
    for (let call of reply) {
      let a = answer.get(call.entity.eid)
      if (a) {
        if (!taken.has(a) && index.get(a)! > at) emit(a)
      } else if (pending(call)) {
        out.push({ kind: 'result', id: spelled(call).id, output: PENDING })
      }
    }
  })
  return out
}
