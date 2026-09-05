// Matching a name someone typed against the names on hand. Nobody types a name
// the way it is stored — the case drifts, the punctuation goes, a long name gets
// abbreviated to its first word — so an exact string compare answers "no such
// author" far too often.
//
// This is scoring only. WHICH entities are addressable by name, and which column
// holds the name, is names.ts; what to do with a winner is the caller's.

// Two names are compared stripped: case, spaces and punctuation carry no
// meaning in a typed name ('le-guin' and 'Le Guin' are the same reach).
let norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '')

// Levenshtein, one row at a time — a genuine algorithm, over one name, so the
// naive table is the right size.
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

// What CONTAINMENT is worth, 0 when it doesn't hold. It earns its place because
// edit distance alone reads a longer name as a stranger — `earthsea` against
// `A Wizard of Earthsea` scores near nothing. Two gates keep it off coincidence:
// the shorter word must COVER most of the longer (else `le` sits inside half the
// shelf), and a PREFIX outranks a word merely spelled inside, because a prefix is
// how a name gets abbreviated.
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
 * What a candidate ANSWERS to, and what each answer is worth: the whole name,
 * and its first word — how a name gets shortened (`Ursula Le Guin` → `ursula`).
 * Interior words sit out: scoring them lets a common word deep inside a long
 * name win outright, and in a large store there is always one.
 */
export let answers = (name: string): [string, number][] => [
  [name, 1],
  [name.split(/\s+/)[0] ?? '', 0.85],
]

/** How close a typed word is to a candidate, over everything it answers to. */
export let closeness = (typed: string, name: string): number =>
  Math.max(...answers(name).map(([w, worth]) => worth * score(typed, w)))

/**
 * Close enough to be the name that was meant. Below this a guess is noise, and
 * answering nothing is the more useful answer.
 */
export let CLOSE = 0.6

/**
 * The candidate whose name is closest to what was typed, or nothing when none
 * is close. `name` reads a candidate's name (a candidate with none sits out);
 * `close` is the floor a winner must clear — pass 1 to accept exact names only.
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
