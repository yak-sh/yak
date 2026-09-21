// Matching a name someone typed against the names available. Nobody types a
// name exactly as it is stored — the case drifts, the punctuation is dropped, a
// long name gets abbreviated to its first word — so an exact string comparison
// returns "no such author" far too often.
//
// This is scoring only. WHICH entities are addressable by name, and which
// column holds the name, is names.ts; what to do with the winner is up to the
// caller.

// Two names are compared with both stripped: case, spaces and punctuation carry
// no meaning in a typed name ('le-guin' and 'Le Guin' find the same entity).
let norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '')

// Levenshtein distance, one row at a time — over a single name, so the naive
// table is the right size.
let dist = (a: string, b: string) => {
  let row = [...Array(b.length + 1).keys()]
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]
    row[0] = i
    for (let j = 1; j <= b.length; j++) {
      let swap = row[j]
      row[j] = Math.min(
        row[j] + 1,
        row[j - 1] + 1,
        prev + (a[i - 1] == b[j - 1] ? 0 : 1),
      )
      prev = swap
    }
  }
  return row[b.length]
}

// What a SUBSTRING match is worth, and 0 when there is none. It earns its place
// because edit distance alone treats a longer name as unrelated — `earthsea`
// against `A Wizard of Earthsea` scores close to nothing. Two conditions keep it
// from firing on coincidence: the shorter string must COVER most of the longer
// one (otherwise `le` is inside half the shelf), and a PREFIX scores higher than
// a substring appearing anywhere else, because a prefix is how a name usually
// gets abbreviated.
let within = (a: string, b: string) => {
  let [small, big] = a.length < b.length ? [a, b] : [b, a]
  if (small.length < 3 || !big.includes(small)) return 0
  if (small.length * 2 < big.length) return 0
  return big.startsWith(small) ? 0.9 : 0.7
}

/**
 * How close a typed word is to a name, from 0 (nothing) to 1 (the same name).
 * Both sides are normalized first, so case and punctuation never decide.
 */
export let score = (typed: string, name: string): number => {
  let [a, b] = [norm(typed), norm(name)]
  return !a || !b ? 0 : a == b ? 1 : within(a, b) ||
    1 - dist(a, b) / Math.max(a.length, b.length)
}

/**
 * The strings a candidate can be matched by, and what each is worth: the whole
 * name, and its first word — which is how a name gets shortened
 * (`Ursula Le Guin` → `ursula`). Words in the middle are excluded: scoring them
 * would let a common word buried in a long name win outright, and in a large
 * store there is always such a word.
 */
export let answers = (name: string): [string, number][] => [
  [name, 1],
  [name.split(/\s+/)[0] ?? '', 0.85],
]

/** How close a typed word is to a candidate, across every string it can be
 * matched by. */
export let closeness = (typed: string, name: string): number =>
  Math.max(...answers(name).map(([w, worth]) => worth * score(typed, w)))

/**
 * The score at which a match is close enough to be the name that was intended.
 * Below this, a guess is noise, and returning nothing is more useful.
 */
export let CLOSE = 0.6

/**
 * The candidate whose name is closest to what was typed, or nothing when none
 * is close enough. `name` reads a candidate's name (a candidate with none is
 * skipped); `close` is the threshold the winner must clear — pass 1 to accept
 * exact names only.
 */
export let nearest = <T>(
  typed: string,
  among: T[],
  name: (x: T) => string | undefined,
  close = CLOSE,
): T | undefined => {
  let best: [T, number] | undefined
  for (let x of among) {
    let n = name(x)
    if (!n) continue
    let hit = closeness(typed, n)
    if (hit >= close && (!best || hit > best[1])) best = [x, hit]
  }
  return best?.[0]
}
