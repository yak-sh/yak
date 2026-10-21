// What each model request carried, part by part. A request is sent as a fixed
// part every request of a session carries (the harness's system prompt, the
// instructions and persona, the listings of skills, tools and agents, each
// tool's schema), then the conversation since the last checkpoint. A walk
// follows a transcript in order, as the importer reads it (./tail.ts) or as
// the graph holds it, keeping both; at each request it lays them out in prompt
// order and splits the usage the provider reported across them with
// @yaks/model's `attribute`. The split goes on the request's entry as
// `context_parts{parts, entries}`. There the fixed part is one key, `fixed`;
// what it is made of is the session's `fixed{parts}`, kept once rather than
// on every request.
//
// Sizes are characters. They only weigh parts against each other: each split
// is scaled to the input the provider reported, so a request's totals are
// measured and the split across its parts is estimated. Where a log never
// shows part of what was sent (Codex's tool schemas, a native transcript read
// back from the graph), the first request's reported input says how much is
// missing, and that becomes the fixed part `unseen`.
//
// The entries a request generated are its own output, not its input: the
// output lines (what the model said, thought and called) since the last line
// that came from elsewhere (an input, a result, a notice) or the last request.
// That holds whether a log writes the request before its output (Claude Code,
// the native runner) or after it (Codex).

import type { Bundle, Comp, Eid } from '@yaks/graph'
import { and, type Clause, eq, present } from '@yaks/query/core'
import {
  attribute,
  type Item,
  type Paid,
  type Part,
  type Tool,
  type Usage,
} from '@yaks/model'

/** What a harness's log says about the fixed part: the parts one source of it
 * holds now, or, with `add`, more of them. */
export type Fixed = { source: string; parts: Part[]; add?: boolean }

/** A transcript followed so far. */
export type Walk = {
  /** the fixed part, by the source each piece came from, in first-seen order */
  fixed: Map<string, Part[]>
  /** whether the fixed part changed since the session last recorded it */
  changed: boolean
  /** the conversation since the last checkpoint: key, size, entry */
  lines: Line[]
  /** where this request's own output can begin in `lines` */
  own: number
  /** tool names by tool entity, and calls by entity */
  names: Map<Eid, string>
  calls: Map<Eid, string>
  /** the model the transcript last asked for */
  model?: string
  /** the previous request, whose later lines name it again */
  last?: Eid
  /** whether part of the fixed part is yet to be sized from a request */
  unseen: boolean
  /** characters per token, to size what a log never showed */
  ratio: number
}

/** A line this large, in tokens, is named on its own as well as by its kind. */
export let BIG = 5000

/** A new walk. `unseen` (default true) sizes what the log never shows from the
 * first request; a log that shows a whole fixed part says so itself. */
export let walker = (
  o: { unseen?: boolean; ratio?: number; names?: Map<Eid, string> } = {},
): Walk => ({
  fixed: new Map(),
  changed: false,
  lines: [],
  own: 0,
  names: o.names ?? new Map(),
  calls: new Map(),
  unseen: o.unseen ?? true,
  ratio: o.ratio ?? 3.5,
})

/** The fixed part's pieces, in order, pieces with one key added together. */
export let fixedParts = (w: Walk): Part[] => {
  let out = new Map<string, number>()
  for (let parts of w.fixed.values()) {
    for (let [k, n] of parts) out.set(k, (out.get(k) ?? 0) + n)
  }
  return [...out]
}

/**
 * Follow what a log says about the fixed part.
 *
 * ```ts
 * import { fix, fixedParts, walker } from '@yaks/session/parts'
 * import { equal } from '@yaks/testing'
 *
 * let w = walker()
 * fix(w, { source: 'tools', parts: [['tool Read', 10]] })
 * fix(w, { source: 'skills', parts: [['skills', 5]] })
 * fix(w, { source: 'skills', parts: [['skills', 2]], add: true })
 * fix(w, { source: 'tools', parts: [['tool Bash', 7]] })
 * equal(fixedParts(w), [['tool Bash', 7], ['skills', 7]])
 * ```
 */
export let fix = (w: Walk, f: Fixed): void => {
  w.fixed.set(f.source, [
    ...(f.add ? w.fixed.get(f.source) ?? [] : []),
    ...f.parts,
  ])
  // Once a log shows the tools, nothing the fixed part holds is unseen.
  if (f.source == 'tools' && !f.add && f.parts.length) {
    w.unseen = false
    w.fixed.delete('unseen')
  }
  w.changed = true
}

let comp = (b: Bundle, name: string) => b[name] as Comp | undefined
let text = (b: Bundle) => String(comp(b, 'content')?.body ?? '')

let named = (w: Walk, eid: unknown) => w.names.get(String(eid)) ?? 'tool'

// What a line is, as a key, or nothing for an entry that is no line.
let kind = (w: Walk, b: Bundle): string | undefined =>
  b.checkpoint
    ? 'checkpoint'
    : b.call
    ? `call ${named(w, comp(b, 'call')!.to)}`
    : b.result
    ? `result ${w.calls.get(String(comp(b, 'result')!.call)) ?? 'tool'}`
    : !b.content || !text(b)
    ? undefined
    : b.reasoning
    ? 'reasoning'
    : b.output
    ? 'output'
    : b.notice
    ? text(b).startsWith('# AGENTS.md') ? 'instructions AGENTS.md' : 'notice'
    : 'input'

/**
 * The entries a part is made of, as a query, where one names them: a
 * `call <tool>` part is the calls to that tool and a `result <tool>` part
 * their results. Every other part is no set of entries a query names, so it
 * has none.
 *
 * ```ts
 * import { partQuery } from './parts.ts'
 * import { stringify } from '@yaks/query'
 * import { equal } from '@yaks/testing'
 *
 * equal(stringify(partQuery('result Bash')!),
 *   '.result&.result.call.call.to.tool.name=Bash')
 * equal(stringify(partQuery('call mcp__tasks__task_new')!),
 *   '.call&.call.to.tool.name=mcp__tasks__task_new')
 * equal(partQuery('input'), undefined)
 * equal(partQuery('tool Bash'), undefined)
 * ```
 */
export let partQuery = (key: string): Clause | undefined => {
  let [, line, tool] = key.match(/^(call|result) (.+)$/) ?? []
  return line == 'call'
    ? and(present('call'), eq('call.to.tool.name', tool))
    : line == 'result'
    ? and(present('result'), eq('result.call.call.to.tool.name', tool))
    : undefined
}

let generating = (key: string) =>
  key == 'output' || key == 'reasoning' || key.startsWith('call ')

let size = (b: Bundle) =>
  text(b).length +
  (b.call && comp(b, 'call')!.args
    ? JSON.stringify(comp(b, 'call')!.args).length
    : 0)

let round = (p: Paid): Paid => p.map(Math.round) as Paid

/** A line of the conversation as a request carried it: its key, its size,
 * and the entry it is, where it is one. */
export type Line = [key: string, size: number, eid?: Eid]

let sum = (ps: [string, number, ...unknown[]][]) =>
  ps.reduce((n, [, s]) => n + s, 0)

/**
 * One request's `context_parts`: the fixed part laid out first as one part,
 * then the conversation's lines, the reported input split across them by
 * where each sits; a line of `BIG` tokens or more is also named on its own.
 * What the request generated is reasoning, as far as the provider counted it,
 * and output.
 *
 * ```ts
 * import { contextParts } from '@yaks/session/parts'
 * import { equal } from '@yaks/testing'
 *
 * let usage = { input_tokens: 20000, cached_tokens: 10000, output_tokens: 9, reasoning_tokens: 4 }
 * equal(contextParts([['tool Read', 50]], [['result Read', 150, 'e1']], usage), {
 *   parts: {
 *     fixed: [5000, 0, 0, 0],
 *     'result Read': [5000, 0, 10000, 0],
 *     output: [0, 0, 0, 5],
 *     reasoning: [0, 0, 0, 4],
 *   },
 *   entries: { e1: [5000, 0, 10000, 0] },
 * })
 * ```
 */
export let contextParts = (
  fixed: Part[],
  lines: Line[],
  u: Usage,
): { parts: Record<string, Paid>; entries?: Record<string, Paid> } => {
  let input = u.input_tokens ?? 0
  let whole = sum(fixed) + sum(lines)
  let scale = whole ? input / whole : 0
  let parts: Part[] = [
    ['fixed', sum(fixed)],
    ...lines.map(([k, n, eid]): Part =>
      eid && n * scale >= BIG ? [`${k}\n${eid}`, n] : [k, n]
    ),
  ]
  let out: Record<string, Paid> = {}
  let entries: Record<string, Paid> = {}
  for (let [key, p] of Object.entries(attribute(u, parts))) {
    let [k, eid] = key.split('\n')
    let at = out[k] ??= [0, 0, 0, 0]
    p.forEach((n, i) => at[i] += n)
    if (eid) entries[eid] = round(p)
  }
  let made = u.output_tokens ?? 0
  let thought = Math.min(u.reasoning_tokens ?? 0, made)
  if (made - thought) (out.output ??= [0, 0, 0, 0])[3] += made - thought
  if (thought) (out.reasoning ??= [0, 0, 0, 0])[3] += thought
  return {
    parts: Object.fromEntries(
      Object.entries(out).map(([k, p]) => [k, round(p)]),
    ),
    ...Object.keys(entries).length ? { entries } : {},
  }
}

// One request of a walk. What its log never showed is sized from the first.
let split = (w: Walk, u: Usage) => {
  let lines = w.lines.slice(0, w.own)
  if (w.unseen) {
    let missing = (u.input_tokens ?? 0) * w.ratio - sum(fixedParts(w)) -
      sum(lines)
    if (missing > 0) {
      w.fixed.set('unseen', [['unseen', Math.round(missing)]])
      w.changed = true
    }
    w.unseen = false
  }
  return contextParts(fixedParts(w), lines, u)
}

/**
 * Follow one entry, in transcript order, and answer what it owes: for a
 * request (an entry carrying `usage`), its `context_parts`, the model where
 * the request did not name one, and the session's `fixed` where the fixed
 * part changed. A request named again (Claude Code writes a reply over several
 * lines, each naming it) owes nothing more.
 *
 * ```ts
 * import { fix, step, walker } from '@yaks/session/parts'
 * import { equal } from '@yaks/testing'
 *
 * let w = walker()
 * fix(w, { source: 'tools', parts: [['tool Read', 40]] })
 * let e = (eid: string, c: object) => ({ entity: { eid }, entry: { session: 's' }, ...c })
 * step(w, e('i', { content: { body: 'x'.repeat(40) } }))
 * let [ask, session] = step(w, e('a', { ask: {}, usage: { input_tokens: 80, cached_tokens: 40, output_tokens: 3 } }))
 * equal(ask.context_parts, { parts: { fixed: [40, 0, 0, 0], input: [0, 0, 40, 0], output: [0, 0, 0, 3] } })
 * equal(session.fixed, { parts: { 'tool Read': 40 } })
 * equal(step(w, e('a', { ask: {}, usage: { input_tokens: 80 } })), [])
 * ```
 */
export let step = (w: Walk, b: Bundle): Bundle[] => {
  let eid = b.entity.eid
  if (b.tool && comp(b, 'tool')?.name) {
    w.names.set(eid, String(comp(b, 'tool')!.name))
  }
  let model = comp(b, 'using')?.model ?? comp(b, 'ask')?.to
  if (model) w.model = String(model)
  if (b.usage) {
    if (eid == w.last) return []
    w.last = eid
    let owed: Bundle[] = [{
      entity: { eid },
      context_parts: split(w, b.usage as Usage),
      ...b.ask && !comp(b, 'ask')!.to && w.model
        ? { ask: { to: w.model } }
        : {},
    }]
    let session = comp(b, 'entry')?.session
    if (w.changed && session) {
      owed.push({
        entity: { eid: String(session) },
        fixed: { parts: Object.fromEntries(fixedParts(w)) },
      })
      w.changed = false
    }
    w.own = w.lines.length
    return owed
  }
  let key = kind(w, b)
  if (!key) return []
  if (b.call) w.calls.set(eid, named(w, comp(b, 'call')!.to))
  if (b.checkpoint) w.lines = []
  w.lines.push([key, size(b), eid])
  if (!generating(key)) w.own = w.lines.length
  return []
}

/**
 * Pieces of instruction text: a persona the graph projects is cut at each
 * part it holds (`persona N-…`, `persona M-…`, `persona reads`), and the rest
 * is the one piece `name`.
 *
 * ```ts
 * import { instructionParts } from '@yaks/session/parts'
 * import { equal } from '@yaks/testing'
 *
 * let persona = '# N-1 common\n\nhi\n\n---\n\n# M-2 a rule\n\nbe\n\n---\n\n## Reads\n\n- M-3'
 * equal(instructionParts(persona).map(([k]) => k), ['persona N-1', 'persona M-2', 'persona reads'])
 * equal(instructionParts('## Core\n\nbe kind'), [['instructions', 16]])
 * ```
 */
export let instructionParts = (body: string, name = 'instructions'): Part[] => {
  let out = new Map<string, number>()
  for (let s of body.split(/\n-{3,}\n+(?=#{1,2} )/)) {
    let head = s.match(/^#{1,2} (\S+)/m)?.[1] ?? ''
    let key = head == 'Reads'
      ? 'persona reads'
      : /^([A-Z]+-\d+|#[0-9a-f]+)$/.test(head)
      ? `persona ${head}`
      : name
    out.set(key, (out.get(key) ?? 0) + s.length)
  }
  return [...out]
}

/** A tool as a piece of the fixed part, sized by what declares it. */
export let toolPart = (tool: Tool | { name?: unknown }): Part => [
  `tool ${String(tool.name ?? 'tool')}`,
  JSON.stringify(tool).length,
]

/**
 * A model request's items as the lines of its conversation: what was typed,
 * said, called and returned, each result named by the tool its call named.
 *
 * ```ts
 * import { itemLines } from '@yaks/session/parts'
 * import { equal } from '@yaks/testing'
 *
 * equal(itemLines([
 *   { kind: 'user', text: 'hi' },
 *   { kind: 'call', id: 'c', name: 'Read', args: '{}' },
 *   { kind: 'result', id: 'c', output: 'abc' },
 * ]), [['input', 2], ['call Read', 2], ['result Read', 3]])
 * ```
 */
export let itemLines = (items: Item[]): Line[] => {
  let calls = new Map<string, string>()
  return items.map((i): Line =>
    i.kind == 'user'
      ? ['input', i.text.length]
      : i.kind == 'assistant'
      ? ['output', i.text.length]
      : i.kind == 'instruction'
      ? ['notice', i.text.length]
      : i.kind == 'call'
      ? (calls.set(i.id, i.name), [`call ${i.name}`, i.args.length])
      : i.kind == 'result'
      ? [`result ${calls.get(i.id) ?? 'tool'}`, i.output.length]
      : ['image', i.bytes.length]
  )
}
