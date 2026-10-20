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
 * state, so only its result travels. */
export let project = (
  transcript: Bundle[],
  window: Bundle[],
  tools: Map<Eid, Declared>,
  opts: {
    anchor?: Eid
    results?: Map<Eid, string>
    media?: Map<Eid, Item[]>
    history?: boolean
    inputText?: (transcript: Bundle[]) => (entry: Bundle) => string
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
  // Each call's final, and the seqs of the progress it reported.
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
  // The first boundary at or past the Pending decides it.
  let sent = (call: string, seq: number) =>
    (bounds[reaching(bounds, seq)] ?? Infinity) <
      (landed.get(call) ?? Infinity)
  let inputText = opts.inputText?.(transcript)
  let logical = replied(
    asks,
    window.filter((b) => {
      let call = comp(b, 'tool_progress')?.call
      return call == null || sent(String(call), seqOf(b)) ||
        !finals.has(String(call))
    }),
    byId,
  )
  for (let b of logical) {
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
        text: inputText?.(b) ?? textOf(b),
      })
    } else if (kind == 'output') {
      out.push({ kind: 'assistant', text: textOf(b) })
    } else if (kind == 'call' && c?.source != opts.anchor) {
      out.push({
        kind: 'call',
        id: String(c!.id),
        name: tools.get(String(c!.to))?.name ?? 'tool',
        args: c!.args == null ? textOf(b) || '{}' : JSON.stringify(c!.args),
      })
    } else if (kind == 'result') {
      let eid = String(comp(b, RESULT)?.call ?? comp(b, 'tool_progress')?.call)
      let call = byId.get(eid)
      if (!call?.call) {
        throw new Error(
          `Result ${b.entity.eid} references missing call ${eid}`,
        )
      }
      let text = opts.results?.get(b.entity.eid) ?? textOf(b)
      let ms = comp(b, RESULT)?.ms
      const output = typeof ms == 'number' ? took(text, ms) : text
      const id = String(comp(call, CALL)?.id ?? '')
      if (
        opts.resultUpdatesAsUser && b.result &&
        progress.get(eid)?.some((seq) => seq < seqOf(b) && sent(eid, seq))
      ) {
        out.push({ kind: 'user', text: `Tool ${id} completed:\n${output}` })
      } else out.push({ kind: 'result', id, output })
    }
    out.push(...opts.media?.get(b.entity.eid) ?? [])
  }
  return out
}
