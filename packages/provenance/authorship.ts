// The writers of the values an entity still holds, rather than its last editor.
import type { Actor, Bundle } from '@yaks/graph'
import { comps } from '@yaks/graph/bundle'
import type { Vocab } from '@yaks/vocab'

export type Span = Actor & { from: number; to: number }
export type Fields = Record<string, Span[]>
type Writers = Map<string, Actor>
type Token = { key: string; from: number; to: number }
let identity = ({ by, via }: Actor) => JSON.stringify([by, via])
let writers = (actors: Actor[]): Writers =>
  new Map(actors.map(({ by, via }) => [identity({ by, via }), { by, via }]))

/** The authors of current values, or the only surviving evidence for a row
 * written before live attribution was retained. */
export let authors = (row?: Bundle): Actor[] => {
  let fields = (row?.authorship as { fields?: Fields } | undefined)?.fields
  return fields
    ? [...writers(Object.values(fields).flat()).values()]
    : [row?.created, row?.updated].filter(Boolean) as Actor[]
}

let leaves = (value: unknown, path: string[], into: Map<string, unknown>) => {
  if (value != null && typeof value == 'object') {
    for (let [k, v] of Object.entries(value)) leaves(v, [...path, k], into)
  } else if (value != null) into.set(JSON.stringify(path), value)
}

let values = (row: Bundle | undefined, vocab: Vocab): Map<string, unknown> => {
  let out = new Map<string, unknown>()
  for (let [c, comp] of comps(row ?? { entity: { eid: '' } })) {
    if (c == 'authorship') continue
    for (let [p, v] of Object.entries(comp ?? {})) {
      if (!vocab.prop(c, p)?.stamped) leaves(v, [c, p], out)
    }
  }
  return out
}

// Word matching is deliberately conservative: two occurrences of the same
// word may be indistinguishable after an edit or move, so both keep its writers.
// Whitespace and punctuation alone do not keep someone's words in a row.
let tokens = (value: unknown): Token[] =>
  typeof value == 'string'
    ? [...value.matchAll(/[\p{L}\p{N}\p{S}_]+/gu)].map((m) => ({
      key: JSON.stringify(m[0]),
      from: m.index,
      to: m.index + m[0].length,
    }))
    : [{ key: JSON.stringify(value), from: 0, to: 1 }]

// Find the first word a span overlaps; walking from there visits only the
// words that writer contributed, including a legacy stamp spanning a field.
let start = (words: Token[], at: number): number => {
  let lo = 0, hi = words.length
  while (lo < hi) {
    let mid = (lo + hi) >>> 1
    if (words[mid].to <= at) lo = mid + 1
    else hi = mid
  }
  return lo
}

let indexed = (
  before: Map<string, unknown>,
  held: Fields | undefined,
  legacy: Actor[],
): Map<string, Writers> => {
  let out = new Map<string, Writers>()
  for (let [key, value] of before) {
    let words = tokens(value)
    let spans = held ? held[key] ?? [] : legacy.map((a) => ({
      ...a,
      from: 0,
      to: typeof value == 'string' ? value.length : 1,
    }))
    for (let span of spans) {
      for (
        let i = start(words, span.from);
        i < words.length && words[i].from < span.to;
        i++
      ) {
        let word = words[i].key, by = out.get(word)
        if (!by) out.set(word, by = new Map())
        by.set(identity(span), { by: span.by, via: span.via })
      }
    }
  }
  return out
}

let attributed = (
  value: unknown,
  index: Map<string, Writers>,
  by: Actor,
): Span[] => {
  let out: Span[] = [], run: Span[] = [], previous = ''
  for (let t of tokens(value)) {
    let named = [...writers([...index.get(t.key)?.values() ?? [], by]).values()]
      .sort((a, b) =>
        identity(a) < identity(b) ? -1 : identity(a) > identity(b) ? 1 : 0
      )
    let key = JSON.stringify(named)
    if (key == previous) {
      for (let s of run) s.to = t.to
    } else {
      run = named.map((a) => ({ ...a, from: t.from, to: t.to }))
      out.push(...run)
      previous = key
    }
  }
  return out
}

/** Attribute the row's current words and primitive values, wherever they
 * moved inside it. Changed values name this writer as well as the writers
 * of their surviving words. Removing a word removes its contributions. */
export let retained = (
  old: Bundle | undefined,
  next: Bundle,
  by: Actor,
  vocab: Vocab,
): Fields => {
  let before = values(old, vocab), after = values(next, vocab)
  let held = (old?.authorship as { fields?: Fields } | undefined)?.fields
  let index = indexed(before, held, authors(old))
  return Object.fromEntries([...after].map(([key, value]) => [
    key,
    held && before.get(key) === value
      ? held[key] ?? []
      : attributed(value, index, by),
  ]))
}
