/**
 * Two texts typed over the same one, made one, losing neither. Each side's
 * change is the one span of the text it rewrote (what differs between the
 * common prefix and the common suffix). Spans apart both apply. Spans that
 * overlap keep both versions of the overlap, mine first, unless one version
 * already holds the other: a write sent again, or typed on from what the other
 * side already has, is taken once. Pure: a store merges with it, and so does
 * an interface catching up with a store.
 *
 * @module
 */

// The one span of `base` that `text` rewrote: where it starts and ends in
// `base`, and what `text` says there.
type Span = { from: number; to: number; says: string }

let span = (base: string, text: string): Span => {
  let n = Math.min(base.length, text.length)
  let a = 0
  while (a < n && base[a] == text[a]) a++
  let z = 0
  while (z < n - a && base.at(-1 - z) == text.at(-1 - z)) z++
  return { from: a, to: base.length - z, says: text.slice(a, text.length - z) }
}

// What `text` says over `base`'s span from `lo` to `hi`, which holds its own.
let over = (base: string, text: string, lo: number, hi: number) =>
  text.slice(lo, text.length - (base.length - hi))

/**
 * `mine` and `theirs`, each typed over `base`, as one text keeping both.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { merge } from '@yaks/draft'
 *
 * assertEquals(merge('ship it', 'ship it now', 'Ship it'), 'Ship it now')
 * assertEquals(merge('', 'a', 'b'), 'ab') // both typed at once: mine first
 * assertEquals(merge('abc', 'aXc', 'aYc'), 'aXYc') // one span: both kept
 * assertEquals(merge('', 'hello', 'hell'), 'hello') // typed on: taken once
 * assertEquals(merge('a b', 'b', 'a b c'), 'b c') // a deletion holds
 * ```
 */
export let merge = (base: string, mine: string, theirs: string): string => {
  if (mine == base || mine == theirs) return theirs
  if (theirs == base) return mine
  let m = span(base, mine)
  let t = span(base, theirs)
  // Two insertions at one point overlap: which goes first is a conflict.
  let point = m.from == m.to && t.from == t.to && m.from == t.from
  if (!point && m.to <= t.from) {
    return base.slice(0, m.from) + m.says + base.slice(m.to, t.from) + t.says +
      base.slice(t.to)
  }
  if (!point && t.to <= m.from) {
    return base.slice(0, t.from) + t.says + base.slice(t.to, m.from) + m.says +
      base.slice(m.to)
  }
  let lo = Math.min(m.from, t.from)
  let hi = Math.max(m.to, t.to)
  let a = over(base, mine, lo, hi)
  let b = over(base, theirs, lo, hi)
  let both = a.includes(b) ? a : b.includes(a) ? b : a + b
  return base.slice(0, lo) + both + base.slice(hi)
}
