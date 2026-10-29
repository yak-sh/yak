// A textarea's edit as one splice: the common prefix and suffix of the old
// and new text bound what was cut and what was put in its place.

/// splice('hello', 'help!') -> { at: 3, cut: 2, put: 'p!' }
/// splice('abc', 'abc') -> { at: 3, cut: 0, put: '' }
/// splice('aaa', 'aaaa') -> { at: 3, cut: 0, put: 'a' }
export let splice = (was, now) => {
  let a = 0
  while (a < was.length && a < now.length && was[a] == now[a]) a++
  let z = 0
  while (
    z < was.length - a && z < now.length - a &&
    was[was.length - 1 - z] == now[now.length - 1 - z]
  ) z++
  return { at: a, cut: was.length - a - z, put: now.slice(a, now.length - z) }
}

/// moved(2, splice('abcdef', 'xabcdef')) -> 3
/// moved(1, splice('abcdef', 'abcdefx')) -> 1
/// moved(4, splice('abcdef', 'abf')) -> 2
/** Where a cursor at `pos` goes when the text around it changes by `s`. */
export let moved = (pos, s) =>
  pos <= s.at
    ? pos
    : pos >= s.at + s.cut
    ? pos - s.cut + s.put.length
    : s.at + s.put.length
