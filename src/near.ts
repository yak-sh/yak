// The near match a failed handle lookup names. Every door takes an entity
// by something a person types — an alias, a human id, a title word — and
// when that resolves to nothing the rejection is only a teaching moment if
// it can name the thing meant: `.project=tasks` is rejected while the
// project called `tasks` exists under the alias `home`.
//
// Scoring lives here; RESOLVING does not. A caller offers the winner only
// after checking the handle it would print resolves, because a suggestion
// routing nowhere costs a reader who is already confused a second wrong
// try. That is the whole reason this is cheap and safe to add.

// What a candidate is compared by: the handle to print, plus the words a
// caller might have been reaching for.
export type Handle = { id: string; alias?: string; title?: string }

// Levenshtein, one row at a time — a genuine algorithm, over an alias or a
// title word, so the naive table is the right size.
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

let norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '')

// How close two words are, on [0,1]. Containment scores high on purpose:
// `tasks` against the title `Task Graph` is the reported shape, and edit
// distance alone reads a longer title as a stranger. But only when the
// shorter word COVERS most of the longer — otherwise every three-letter
// stub is inside somebody's title, and `jef` names a task about jeff.
let covers = (a: string, b: string) => {
  let [short, long] = a.length < b.length ? [a, b] : [b, a]
  return short.length > 2 && long.includes(short) &&
    short.length * 2 >= long.length
}
let score = (a: string, b: string) =>
  !a || !b
    ? 0
    : a == b
    ? 1
    : covers(a, b)
    ? 0.85
    : 1 - dist(a, b) / Math.max(a.length, b.length)

// A candidate's best word against the typed one — its alias, its whole
// title, or any single title word.
let closeness = (v: string, h: Handle) =>
  Math.max(
    ...[h.alias ?? '', h.title ?? '', ...(h.title ?? '').split(/\s+/)]
      .map((w) => score(v, norm(w))),
  )

// Close enough to be worth a reader's second try. Below this the guess is
// noise, and silence is the more useful answer.
let CLOSE = 0.6

// The best candidate for `v`, or nothing when none is close.
export let nearest = <T extends Handle>(v: string, of: T[]) => {
  let typed = norm(v)
  if (!typed) return
  let best = of
    .map((h) => [h, closeness(typed, h)] as const)
    .sort(([, a], [, b]) => b - a)[0]
  return best && best[1] >= CLOSE ? best[0] : undefined
}

// The offer, spelled as the caller should type it: 'home' (P-19, Task
// Graph). The handle leads because that is the part they got wrong.
export let offer = (h: Handle) => {
  let lead = h.alias ? `'${h.alias}'` : h.id
  let rest = [h.alias && h.id, h.title].filter(Boolean)
  return rest.length ? `${lead} (${rest.join(', ')})` : lead
}
