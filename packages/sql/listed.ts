// A store's options carry lists of a hundred names or more (the components no
// table holds yet, the indexes the file lacks), and every read and statement
// keys its options. A list is named by a number instead: one for every list
// spelling the same names in the same order, worked out once for each list.

let lists = new WeakMap<readonly string[], number>()
let spelled = new Map<string, number>()
let count = 0
// Spellings kept to find a list's number again; past this many, a new list
// gets a new number, which only misses what the old one kept.
let SPELLINGS = 1024

/**
 * The number for a list of names; 0 for none.
 *
 * ```ts
 * import { listed } from '@yaks/sql'
 * import { assertEquals, assertNotEquals } from '@std/assert'
 *
 * assertEquals(listed(['doc', 'task']), listed(['doc', 'task']))
 * assertNotEquals(listed(['doc', 'task']), listed(['task', 'doc']))
 * assertEquals(listed(undefined), 0)
 * ```
 */
export let listed = (names: readonly string[] | undefined): number => {
  if (!names) return 0
  let n = lists.get(names)
  if (n == null) {
    let text = JSON.stringify(names)
    n = spelled.get(text)
    if (n == null) {
      if (spelled.size >= SPELLINGS) spelled.clear()
      spelled.set(text, n = ++count)
    }
    lists.set(names, n)
  }
  return n
}
