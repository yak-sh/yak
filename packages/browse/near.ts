// The near match a failed handle lookup names. Every door takes an entity
// by something a person types — an alias, a human id, a title word — and
// when that resolves to nothing the rejection is only a teaching moment if
// it can name the thing meant: `.filed.project=tasks` is rejected while the
// project called `tasks` exists under the alias `home`.
//
// Scoring lives here; RESOLVING does not. A caller offers the winner only
// after checking the handle it would print resolves, because a suggestion
// routing nowhere costs a reader who is already confused a second wrong
// try. That is the whole reason this is cheap and safe to add.
import { CLOSE, score } from '@yaks/names'

// What a candidate is compared by: the handle to print, plus the words a
// caller might have been reaching for. `named` says the title IS a name
// and may be matched on; without it the title still SHOWS — a reader needs
// to recognize what they are being offered — but never wins a match.
export type Handle = {
  id: string
  alias?: string
  title?: string
  named?: boolean
}

// What a candidate answers to, and what each answer is worth. An ALIAS is
// the handle — the thing a caller types — so it carries full weight; a
// title is what they read; the title's FIRST word is how a name gets
// abbreviated (`Task Graph` → tasks).
//
// Interior title words are deliberately absent. Scoring them let a common
// noun inside somebody's sentence win outright: `tasks` matched T-97
// ("… for new tasks (title + body)") at 1.0 and beat the project named
// Task Graph. A word deep in a long title is a coincidence, and the
// untargeted pool is the whole graph, so there is always one. Where the
// title is SHORT the containment rule already reaches its later words —
// `graph` covers most of `taskgraph` — which is the case worth having.
//
// A title that is not a NAME sits out entirely: a task reads "Tasks: add
// cancelled state…", which opens with the word and means nothing by it.
//
// A word answers once, at the most it is worth: a project's alias is often
// its title, and a one-word title its own first word.
let answers = (h: Handle): [string, number][] => {
  let title = h.named ? h.title ?? '' : ''
  let words: [string, number][] = [
    [h.alias ?? '', 1],
    [title, 0.95],
    [title.split(/\s+/)[0] ?? '', 0.85],
  ]
  return words.filter(([w], i) => words.findIndex(([x]) => x == w) == i)
}

// Each word is scored the way @yaks/names scores a typed name: containment
// that covers most of the longer word, else edit distance. That is what
// reaches `Task Graph` from `tasks`, and leaves `jef` inside every title
// about jeff@yak.sh a coincidence.
let closeness = (v: string, h: Handle) =>
  Math.max(...answers(h).map(([w, worth]) => worth * score(v, w)))

// The best candidate for `v`, or nothing when none is close enough to be
// worth a reader's second try. A tie goes to the one carrying an ALIAS: two
// entities wear the name `Task Graph` — the project and the board over it —
// and the aliased one is the one somebody decided should be addressable by
// name.
export let nearest = <T extends Handle>(v: string, of: T[]) => {
  let handled = (h: Handle) => (h.alias ? 1 : 0)
  let best = of
    .map((h) => [h, closeness(v, h)] as const)
    .sort(([a, x], [b, y]) => y - x || handled(b) - handled(a))[0]
  return best && best[1] >= CLOSE ? best[0] : undefined
}

// The offer, spelled as the caller should type it: 'home' (P-19, Task
// Graph). The handle leads because that is the part they got wrong.
export let offer = (h: Handle) => {
  let lead = h.alias ? `'${h.alias}'` : h.id
  let rest = [h.alias && h.id, h.title].filter(Boolean)
  return rest.length ? `${lead} (${rest.join(', ')})` : lead
}
