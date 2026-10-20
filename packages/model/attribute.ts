// How one request's tokens were paid, part by part. A provider reports a
// request's usage whole: so many input tokens read from its prompt cache, so
// many written to it, the rest of the input fresh, and the output. A prompt is
// cached as a prefix, in the order it is sent (tools, system, then the
// conversation), so the tier a token was paid in follows from where it sits:
// the first `cached_tokens` of the input were read, the next
// `cache_write_tokens` written, the rest were fresh. Laying a request's parts
// out in that order, each sized by its text and scaled so the sizes sum to the
// reported input, says what each part cost. The totals are measured; the split
// across parts is an estimate from their sizes.

import type { Usage } from './vocab.ts'

/** One part of a request: its key, and its size in any unit (characters). */
export type Part = [key: string, size: number]

/** A part's tokens by how they were paid: read from the cache, written to it,
 * sent fresh, and generated. */
export type Paid = [read: number, write: number, fresh: number, output: number]

let add = (to: Record<string, Paid>, key: string, i: number, n: number) => {
  if (!n) return
  let p = to[key] ??= [0, 0, 0, 0]
  p[i] += n
}

/**
 * A request's input tokens, split across its parts in prompt order: each part
 * scaled from its size to its share of `input_tokens`, then paid by where it
 * sits. Parts with one key add up; an input with no sized part is all
 * `unseen`.
 *
 * ```ts
 * import { attribute } from '@yaks/model'
 * import { equal } from '@yaks/testing'
 *
 * let usage = { input_tokens: 100, cached_tokens: 60, cache_write_tokens: 30 }
 * equal(attribute(usage, [['tools', 50], ['chat', 30], ['tools', 0], ['new', 20]]), {
 *   tools: [50, 0, 0, 0],
 *   chat: [10, 20, 0, 0],
 *   new: [0, 10, 10, 0],
 * })
 * equal(attribute({ input_tokens: 5 }, []), { unseen: [0, 0, 5, 0] })
 * ```
 */
export let attribute = (u: Usage, parts: Part[]): Record<string, Paid> => {
  let total = Math.max(0, u.input_tokens ?? 0)
  let read = Math.min(Math.max(0, u.cached_tokens ?? 0), total)
  let write = Math.min(Math.max(0, u.cache_write_tokens ?? 0), total - read)
  let size = parts.reduce((n, [, s]) => n + Math.max(0, s), 0)
  if (!size) parts = [['unseen', size = 1]]
  let out: Record<string, Paid> = {}
  let at = 0
  for (let [key, s] of parts) {
    let n = total * Math.max(0, s) / size
    let end = at + n
    add(out, key, 0, Math.max(0, Math.min(end, read) - at))
    add(
      out,
      key,
      1,
      Math.max(0, Math.min(end, read + write) - Math.max(at, read)),
    )
    add(out, key, 2, Math.max(0, end - Math.max(at, read + write)))
    at = end
  }
  return out
}

/**
 * Generated tokens split across what a request generated, by size; with
 * nothing sized, all of it is `fallback`'s.
 *
 * ```ts
 * import { generated } from '@yaks/model'
 * import { equal } from '@yaks/testing'
 *
 * equal(generated(90, [['output', 20], ['call Bash', 10]]), {
 *   output: [0, 0, 0, 60],
 *   'call Bash': [0, 0, 0, 30],
 * })
 * equal(generated(7, [], 'reasoning'), { reasoning: [0, 0, 0, 7] })
 * ```
 */
export let generated = (
  tokens: number,
  parts: Part[],
  fallback = 'output',
): Record<string, Paid> => {
  let size = parts.reduce((n, [, s]) => n + Math.max(0, s), 0)
  if (!size) parts = [[fallback, size = 1]]
  let out: Record<string, Paid> = {}
  for (let [key, s] of parts) add(out, key, 3, tokens * Math.max(0, s) / size)
  return out
}

/**
 * Several splits as one, adding what they share.
 *
 * ```ts
 * import { merged } from '@yaks/model'
 * import { equal } from '@yaks/testing'
 *
 * equal(merged({ a: [1, 0, 0, 0] }, { a: [0, 0, 0, 2], b: [0, 1, 0, 0] }), {
 *   a: [1, 0, 0, 2],
 *   b: [0, 1, 0, 0],
 * })
 * ```
 */
export let merged = (
  ...splits: Record<string, Paid>[]
): Record<string, Paid> => {
  let out: Record<string, Paid> = {}
  for (let s of splits) {
    for (let [key, p] of Object.entries(s)) {
      p.forEach((n, i) => add(out, key, i, n))
    }
  }
  return out
}
