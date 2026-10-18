// A checkpoint is the summary of a transcript prefix. The summary can be
// appended after newer entries: `through` names the last entry it replaces,
// so the next model sees retained instructions, the summary, then a
// protocol-complete suffix.

import type { Bundle, Comp } from '@yaks/graph'
import { ANSWER, QUESTIONS } from '@yaks/model'
import { USING } from './native.ts'
import { kindOf, newestAsk, seqOf } from './state.ts'

let callOf = (b: Bundle): string | undefined => {
  let call = ((b.result ?? b.tool_progress) as Comp | undefined)?.call
  return call == null ? undefined : String(call)
}

// A result always travels with the call that gives it its provider id. An
// input may land while that call is running, so an input boundary alone does
// not keep the pair together.
let paired = (entries: Bundle[], end: number): number => {
  let calls = new Map(
    entries.flatMap((b, i) => b.call ? [[b.entity.eid, i] as const] : []),
  )
  while (true) {
    let split = entries.slice(end)
      .map(callOf)
      .flatMap((eid) => eid == null ? [] : [calls.get(eid)])
      .filter((i): i is number => i != null && i < end)
    let next = split.length ? Math.min(...split) : end
    if (next == end) return end
    end = next
  }
}

/** A suffix beginning no later than any call its results refer to. */
export let suffix = (entries: Bundle[], from: number): Bundle[] =>
  entries.slice(paired(entries, from))

/** Explicitly admitted context (persona, skills, delegation instructions) is
 * kept verbatim. Ordinary file reads and tool results are history, not a way
 * to admit instructions. */
export let retained = (entries: Bundle[]): Bundle[] =>
  entries.filter((b) => b.prompt)

export let history = (entries: Bundle[]): Bundle[] =>
  entries.filter((b) => !b.prompt && !b.task_context)

export let context = (entries: Bundle[]): Bundle[] => {
  let mark = entries.filter((b) => b.checkpoint).at(-1)
  if (!mark) return entries
  let through = (mark.checkpoint as Comp).through
  let boundary = through ? entries.find((b) => b.entity.eid == through) : mark
  let seq = boundary ? seqOf(boundary) : Number((mark.checkpoint as Comp).seq)
  if (!Number.isSafeInteger(seq) || seq < 1) {
    throw new Error('Checkpoint has no boundary: ' + through)
  }
  let rest = entries.filter((b) => !b.prompt && b != mark)
  let from = rest.findIndex((b) => seqOf(b) > seq)
  return [
    ...retained(entries),
    mark,
    ...suffix(rest, from < 0 ? rest.length : from),
  ]
}

/** The context window, in tokens, of a model whose row and provider name
 * none (@yaks/model `model.context`, `provider.context`). */
export let CONTEXT = 128_000

/** The share of its model's context window a transcript fills before it is
 * compacted, for every model, unless a runner names another (`Deps.compactAt`):
 * half, so a summary and the lines kept after it leave room to work. */
export let SHARE = 0.5

/** Asks a transcript takes after a checkpoint before another may be written,
 * whatever it weighs, except a length refusal that needs an immediate cut. */
export let GAP = 4

/** What a share of `window` comes to, a share outside 10 to 90 percent held
 * to the nearer bound, so a reply always has room. */
/// limit(1_000_000, 0.5) -> 500_000
/// limit(100_000, 2) -> 90_000
export let limit = (window: number, share: number): number =>
  Math.floor(window * Math.min(0.9, Math.max(0.1, share)))

/** About how many tokens a model reads for this many characters of
 * projected text, where its provider has not counted them. */
export let tokens = (chars: number): number => Math.ceil(chars / 4)

/** The oldest lines to summarize, so that the newest ones kept weigh at most
 * `keep` (each line's weight is its place in `sizes`), cut where no result is
 * parted from its call: all of them when no such cut keeps anything. */
/// let line = (seq: number) => ({ entity: { eid: `e${seq}` }, entry: { seq } })
/// prefix([1, 2, 3, 4].map(line), [10, 10, 10, 10], 25).length -> 2
/// prefix([1, 2].map(line), [10, 50], 25).length -> 2
export let prefix = (
  entries: Bundle[],
  sizes: number[],
  keep: number,
): Bundle[] => {
  let from = entries.length, kept = 0
  while (from > 1 && kept + sizes[from - 1] <= keep) kept += sizes[--from]
  let end = entries.findIndex((_, i) => i >= from && paired(entries, i) == i)
  return end < 0 ? entries : entries.slice(0, end)
}

/** A provider's length refusal, including providers that use a generic input
 * code and say what exceeded the window in their message. */
export let tooLong = (code: string, text: string): boolean =>
  [
    'context_length_exceeded',
    'prompt_too_long',
    'request_too_large',
    'max_tokens_exceeded',
    'context_window_exceeded',
  ].includes(code) ||
  /prompt is too long|exceeds? (?:the )?(?:maximum|context|token)|(?:context|input|prompt)[\s\S]{0,80}(?:too long|length exceeded)/i
    .test(text)

/** Only an explicitly stated token limit, never the request's token count.
 * The catalog and a configured window are not evidence of enforcement. */
/// ceiling("maximum context length is 272,000 tokens; sent 350,000") -> 272000
/// ceiling("prompt is too long: 350000 tokens > 272000 maximum") -> 272000
/// ceiling("your request has 350000 tokens") -> undefined
export let ceiling = (text: string): number | undefined => {
  let match = [
    /maximum context length (?:is|of) ([\d,]+) tokens/i,
    /(?:context window|token limit|context limit)(?: is| of|:)?\s*([\d,]+)(?: tokens)?/i,
    /([\d,]+) tokens?\s*>\s*([\d,]+)\s*(?:maximum|max|tokens? allowed)/i,
    /maximum (?:number of )?(?:input )?tokens(?: allowed)?\s*[:(]?\s*([\d,]+)/i,
  ].map((re) => re.exec(text)).find(Boolean)
  let value = match && Number((match[2] ?? match[1]).replaceAll(',', ''))
  return value && Number.isSafeInteger(value) && value > 0 ? value : undefined
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
    !(b.notice && b.output && !b.checkpoint) &&
      !(QUESTIONS in b || ANSWER in b) &&
      ['input', 'output', 'call', 'result'].includes(kindOf(b) ?? '')
  )

/** The newest `n` lines of a transcript, reaching back to the input that
 * began the turn they cut into, so no call or result is sent without its
 * pair: what a turn sends when its `sending.window` is `n`. All of them when
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
export let askingOf = (entries: Bundle[]): Bundle | undefined => {
  let last = newestAsk(entries)
  let since = last ? seqOf(last) : 0
  let asking = entries.filter((b) =>
    (QUESTIONS in b || USING in b || 'sending' in b) && seqOf(b) > since
  ).at(-1)
  let asked = asking && (asking[QUESTIONS] as Comp | undefined)?.asked
  return asked && typeof asked == 'object' && !Array.isArray(asked)
    ? asking
    : undefined
}
