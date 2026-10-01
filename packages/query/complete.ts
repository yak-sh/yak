// Completion: what can come next in a query, at the caret. One engine for
// every place a query is typed — the inspector, a filter bar, the terminal, a
// shell's tab.
//
// `complete(vocab, text, caret)` reads the word under the caret and offers what
// the grammar and the loaded vocabulary allow there: components, properties,
// reverse associations, operators, directives, enum members, time phrases.
// Each candidate is the whole word as it reads once taken, labeled with where
// it comes from — its component, `· stamped` for a property only the server
// writes, `· ref` for a reference, the operator's meaning, the enum's
// property. A word that already reads whole (`.effect`, `.task.status=open`)
// is never offered back; the answer says it is `whole`, so a field keeps it as
// typed, and what extends it comes before what rewrites it (`!effect`).
//
// A property is offered as it must be written, with its component: `.ti`
// offers the component `.timing` and the properties `.foo.timing` and
// `.doc.title`, so a person who remembers a property's name and not its
// component finds both. Exact names come first, then what the rest of the
// line already names (`.task .s` puts `.task.status` before
// `.session.status`); that orders the list and never decides what a word
// means.
//
// What only a graph can answer — the entities a reference could name, the
// values a property holds — comes from a source the caller supplies, so this
// file stays pure. A source that answers with a promise makes the whole answer
// a promise; one that answers at once keeps it synchronous.

import { cmp } from '@yaks/fp'
import type { Hop, Vocab } from '@yaks/vocab'
import type { Clause } from './ast.ts'
import { DIRECTIVES, OPERATORS } from './teach.ts'
import { parse, valued } from './parse.ts'

/** One thing that could be typed: the word as it reads once taken, and where
 * it comes from. */
export type Cand = { text: string; kind: string }

/** The candidates for the word from `from` to the caret (`to`); taking one
 * replaces that span with its text. `whole` says the word already reads
 * whole as typed, so a query may end there. */
export type Completion = {
  from: number
  to: number
  cands: Cand[]
  whole: boolean
}

type Found = Cand[] | Promise<Cand[]>

/** What only a graph can answer. Each is asked with the prefix typed so far
 * and answers with the values that fit it (not whole words); left out, it
 * offers nothing. */
export type Source<F extends Found = Found> = {
  /** entities a reference to `ref` could name (`entity`: any), by the id a
   * person types, each labeled (by its kind, say) */
  ids?: (ref: string, prefix: string) => F
  /** the values `comp.prop` holds, most common first (`.tally`) */
  values?: (comp: string, prop: string, prefix: string) => F
  /** the rankings this host's evaluator answers (`hot`, `similar`) */
  ranks?: string[]
}

type At = { v: Vocab; line: Set<string>; source: Source }

let then = <A, B>(x: A | Promise<A>, f: (a: A) => B): B | Promise<B> =>
  x instanceof Promise ? x.then(f) : f(x)

let starts = (s: string, pre: string) =>
  s.toLowerCase().startsWith(pre.toLowerCase())

// Candidates that read on from what was typed, the word itself among them.
let fits = (words: Cand[], pre: string): Cand[] =>
  words.filter((c) => starts(c.text, pre))

let cands = (words: string[], kind: string): Cand[] =>
  words.map((text) => ({ text, kind }))

// Whitespace, `&`, `|` and parentheses end a word. A comma does too, until a
// clause takes an operator: `.entity,.cre` is two clauses, `.p=a,b` one.
let SEP = /[\s&|()]/
let start = (text: string, caret: number): number => {
  let from = caret
  while (from > 0 && !SEP.test(text[from - 1])) from--
  let word = text.slice(from, caret), cut = 0
  for (let i = word.indexOf(','); i >= 0; i = word.indexOf(',', i + 1)) {
    if (!valued(word.slice(cut, i))) cut = i + 1
  }
  return from + cut
}

// The components the rest of the line names outright, which come first among
// the candidates. A line that does not parse yet names none.
let named = (v: Vocab, rest: string): Set<string> => {
  let out = new Set<string>()
  let add = (path: string[]) => v.comp(path[0]) && out.add(path[0])
  let walk = (cs: Clause[]): void => {
    for (let c of cs) {
      if (c.kind == 'and' || c.kind == 'or') walk(c.clauses)
      else if (c.kind == 'pred' || c.kind == 'tally' || c.kind == 'distinct') {
        add(c.path)
      } else if (c.kind == 'fields') c.fields.forEach((f) => add(f.path))
    }
  }
  try {
    walk(parse(rest).clauses)
  } catch { /* a line still being typed names nothing yet */ }
  return out
}

// The spine's eid is no declared column, and is still named `.entity.eid`.
let columns = (v: Vocab, comp: string): string[] =>
  comp == 'entity' ? [...v.props(comp), 'eid'] : v.props(comp)

// A property's label: its component, and what it is when that matters.
let mark = (v: Vocab, comp: string, prop: string): string => {
  let p = v.prop(comp, prop)
  return p?.category == 'ref'
    ? `${comp} · ref`
    : p?.stamped
    ? `${comp} · stamped`
    : comp
}

let ref = (v: Vocab, hop: Hop): boolean =>
  v.prop(hop.comp, hop.prop)?.category == 'ref'

// Where a settled path leaves the next segment: on a component, which offers
// its own properties; past a reference (or at the head of a line), where
// anything an entity carries can follow; or nowhere. The walk is @yaks/vocab's
// `aim` taken one step at a time, since the last segment is still being
// typed: a component and one of its properties, then the next pair.
type Next = { comp: string } | { far: true } | null
let next = (v: Vocab, segs: string[]): Next => {
  let hop: Hop | undefined
  for (let i = 0; i < segs.length;) {
    if (hop && !ref(v, hop)) return null
    let seg = segs[i]
    if (v.comp(seg)) {
      if (i + 1 == segs.length) return { comp: seg }
      if (!columns(v, seg).includes(segs[i + 1])) return null
      hop = { comp: seg, prop: segs[i + 1] }
      i += 2
    } else if (i == 0 && v.assoc(seg)) {
      // A reverse association at the head reads its children from here on.
      i += 1
    } else return null
  }
  return !hop || ref(v, hop) ? { far: true } : null
}

// A `_` component describes the vocabulary itself (`_comp`, `_prop`), so it
// follows the application's own components.
let inner = (a: string, b: string): number =>
  Number(a.startsWith('_')) - Number(b.startsWith('_')) || cmp(a, b)

// A candidate and where it ranks: an exact name first, then one whose
// component the line names, each family's own order kept within.
type Ranked = Cand & { rank: number }
let ranked =
  (at: At, pre: string, comp: string, name: string) => (c: Cand): Ranked => ({
    ...c,
    rank: (name.toLowerCase() == pre.toLowerCase() ? 0 : 2) +
      (at.line.has(comp) ? 0 : 1),
  })
let sorted = (cs: Ranked[]): Cand[] =>
  cs.map((c, i) => ({ c, i }))
    .toSorted((a, b) => a.c.rank - b.c.rank || a.i - b.i)
    .map(({ c: { text, kind } }) => ({ text, kind }))

// The names that can follow `lead` (a prefix character and the settled
// segments), by family: components (`dot` leads on to their properties, for
// where a component alone is no word), properties, each with its component,
// and the reverse associations a clause may start with.
type Names = { comps: Ranked[]; props: Ranked[]; reverse: Ranked[] }
let names = (
  at: At,
  lead: string,
  segs: string[],
  pre: string,
  dot: boolean,
): Names => {
  let n = next(at.v, segs)
  let v = at.v
  if (!n) return { comps: [], props: [], reverse: [] }
  if ('comp' in n) {
    let comp = n.comp
    return {
      comps: [],
      props: columns(v, comp).filter((p) => starts(p, pre)).toSorted()
        .map((p) =>
          ranked(at, pre, comp, p)({ text: lead + p, kind: mark(v, comp, p) })
        ),
      reverse: [],
    }
  }
  let all = v.all.toSorted(inner)
  return {
    comps: all.filter((c) => starts(c, pre)).map((c) =>
      ranked(at, pre, c, c)({
        text: lead + c + (dot && columns(v, c).length ? '.' : ''),
        kind: 'comp',
      })
    ),
    props: all
      .flatMap((c) =>
        columns(v, c).filter((p) => starts(p, pre)).map((p) => ({ c, p }))
      )
      .toSorted((a, b) => cmp(a.p, b.p) || inner(a.c, b.c))
      .map(({ c, p }) =>
        ranked(at, pre, c, p)({ text: `${lead}${c}.${p}`, kind: mark(v, c, p) })
      ),
    reverse: segs.length ? [] : v.assocs()
      .filter(([name]) => starts(name, pre))
      .toSorted(([a], [b]) => a.localeCompare(b))
      .map(([name, a]) =>
        ranked(at, pre, a.comp, name)({
          text: lead + name,
          kind: `${a.comp} · reverse`,
        })
      ),
  }
}

// After a whole property, the operators, and a range to fill in.
let ops = (word: string): Cand[] => [
  ...OPERATORS.map((o) => ({ text: word + o.spell, kind: o.word })),
  { text: word + '=..', kind: 'range' },
]

// A component alone is its own presence test; the other questions about it
// are prefix forms, which rewrite the word rather than read on from it.
let presence = (name: string): Cand[] => [
  { text: '!' + name, kind: 'absent' },
  { text: '?' + name, kind: 'wanted' },
]

// What may follow a word that already names something: a component's
// properties, a property's operators.
let exact = (at: At, segs: string[], name: string, word: string): Cand[] => {
  let n = next(at.v, segs)
  if (!n || !name) return []
  if ('comp' in n) return columns(at.v, n.comp).includes(name) ? ops(word) : []
  return at.v.comp(name) && columns(at.v, name).length
    ? [{ text: word + '.', kind: 'comp' }]
    : []
}

// The directives written as a dotted name: `.order=`, `.count`, `.limit=`.
let directives = (pre: string): Cand[] =>
  DIRECTIVES.filter((d) =>
    d.spell.startsWith('.') && starts(d.spell.slice(1), pre)
  ).map((d) => ({ text: d.spell, kind: d.word }))

// A path being typed: `.sta`, `.task.`, `.task.assignee.ti`, `!propo`, `?lo`.
let path = (at: At, word: string, sigil: string, dotted: string): Cand[] => {
  let segs = dotted.split('.')
  let pre = segs.pop()!
  let lead = sigil + segs.map((s) => s + '.').join('')
  let n = names(at, lead, segs, pre, false)
  if (sigil == '?') return sorted(n.comps)
  let found = sorted([...n.comps, ...n.props, ...n.reverse])
  if (sigil == '!') return found
  return [
    ...exact(at, segs, pre, word),
    ...found,
    ...segs.length ? [] : fits(directives(pre), word),
    ...!segs.length && at.v.comp(pre) ? presence(pre) : [],
  ]
}

// A half-typed operator wants the rest of itself: `.p!` → `.p!=`.
let half = (word: string, op: string): Cand[] =>
  OPERATORS.filter((o) => o.spell != op && o.spell.startsWith(op))
    .map((o) => ({ text: word.slice(0, -op.length) + o.spell, kind: o.word }))

// A taste of the time grammar, hyphen-glued so a candidate stays one word.
let TIMES = [
  'today',
  'yesterday',
  'this-week',
  'last-week',
  'this-month',
  '1-hour-ago',
  '7-days-ago',
]

let ids = (at: At, ref: string, pre: string): Found =>
  at.source.ids?.(ref, pre) ?? []

// The values one property takes: its enum spells itself, a reference names
// entities, a flag is 1 or 0, a time takes a phrase, and anything else is what
// the source has seen it hold.
let slot = (at: At, hop: Hop, pre: string): Found => {
  if (hop.prop == 'eid') return ids(at, 'entity', pre)
  let p = at.v.prop(hop.comp, hop.prop)
  if (!p) return []
  if (p.category == 'enum') return fits(cands(p.values ?? [], hop.prop), pre)
  if (p.category == 'ref') return ids(at, p.ref || 'entity', pre)
  if (p.scalar == 'bool') {
    return fits(
      [{ text: '1', kind: 'true' }, { text: '0', kind: 'false' }],
      pre,
    )
  }
  if (p.scalar == 'time') return fits(cands(TIMES, 'time'), pre)
  return at.source.values?.(hop.comp, hop.prop, pre) ?? []
}

// A property path as a directive's value (`.tally=task.status`,
// `.fields=pin.x`), the properties first, since a component alone is no value
// there.
let field = (at: At, typed: string): Cand[] => {
  let segs = typed.split('.')
  let pre = segs.pop()!
  let lead = segs.map((s) => s + '.').join('')
  let n = names(at, lead, segs, pre, true)
  return sorted([...n.props, ...n.comps.filter((c) => c.text.endsWith('.'))])
}

// A directive's value: a ranking or a property to order by, the property an
// aggregate or a projection reads, the entity a ranking or a window names.
// Undefined for a name that is no directive.
let directed = (at: At, name: string, value: string): Found | undefined => {
  if (name == 'order') {
    let desc = value.startsWith('-') ? '-' : ''
    return [
      ...desc ? [] : fits(cands(at.source.ranks ?? [], 'rank'), value),
      ...field(at, value.slice(desc.length))
        .map((c) => ({ ...c, text: desc + c.text })),
    ]
  }
  if (name == 'tally' || name == 'distinct') return field(at, value)
  if (name == 'fields') {
    let cut = value.lastIndexOf(',') + 1
    return field(at, value.slice(cut))
      .map((c) => ({ ...c, text: value.slice(0, cut) + c.text }))
  }
  if (name == 'near' || name == 'refs' || name == 'after') {
    return ids(at, 'entity', value)
  }
  if (name == 'limit') return []
}

// The value after an operator. Only the last part of an any-of list
// completes; the parts before it stay as typed.
let value = (
  at: At,
  word: string,
  dotted: string,
  op: string,
  typed: string,
): Found => {
  let head = word.slice(0, word.length - typed.length)
  let segs = dotted.split('.')
  let d = segs.length == 1 && op == '='
    ? directed(at, segs[0], typed)
    : undefined
  if (d) {
    return then(d, (found) => found.map((c) => ({ ...c, text: head + c.text })))
  }
  let cut = typed.lastIndexOf(',') + 1
  let lead = head + typed.slice(0, cut), pre = typed.slice(cut)
  let hops: Hop[]
  try {
    hops = at.v.aim(segs.join('.'))
  } catch {
    return []
  }
  let leaf = hops[hops.length - 1]
  if (!leaf.prop || hops.slice(0, -1).some((h) => !ref(at.v, h))) return []
  return then(
    slot(at, leaf, pre),
    (found) =>
      found.filter((c) => c.text).map((c) => ({ ...c, text: lead + c.text })),
  )
}

let SEG = '[A-Za-z_]+(?:-[A-Za-z_]+)*'
let DOTTED = `${SEG}(?:\\.${SEG})*`
let VALUE = new RegExp(`^\\.?(${DOTTED})(!=|~=|<=|>=|<|>|=)(.*)$`, 's')
let HALF = new RegExp(`^\\.${DOTTED}([!~])$`)
let PATH = new RegExp(`^([.!?])((?:${SEG}\\.)*[A-Za-z_-]*)$`)

// What the engine found for `word`, as answered: the word itself is not
// offered but makes the answer whole, and a word two families name is
// offered once.
let answer = (word: string, found: Cand[]) => {
  let seen = new Set([word])
  return {
    cands: found.filter((c) => !seen.has(c.text) && seen.add(c.text)),
    whole: found.some((c) => c.text == word),
  }
}

let offer = (at: At, word: string): Found => {
  let m = word.match(VALUE)
  if (m) return value(at, word, m[1], m[2], m[3])
  let h = word.match(HALF)
  if (h) return half(word, h[1])
  let p = word.match(PATH)
  if (p) return path(at, word, p[1], p[2])
  return []
}

/**
 * What can come next at the caret: the span of the word under it and the
 * candidates to replace that span with. `caret` defaults to the end of the
 * text; `source` answers what only a graph knows.
 *
 * ```ts
 * import { loadVocab } from '@yaks/vocab'
 * import { complete } from '@yaks/query'
 *
 * let v = loadVocab({
 *   $defs: {
 *     task: {
 *       component: true,
 *       properties: { status: { type: 'string', enum: ['open', 'done'] } },
 *     },
 *   },
 * })
 * complete(v, '.sta')
 * // { from: 0, to: 4, cands: [{ text: '.task.status', kind: 'task' }],
 * //   whole: false }
 * complete(v, '.task.status=o')
 * // { from: 0, to: 14, cands: [{ text: '.task.status=open', kind: 'status' }],
 * //   whole: false }
 * ```
 */
export function complete(
  v: Vocab,
  text: string,
  caret?: number,
  source?: Source<Cand[]>,
): Completion
export function complete(
  v: Vocab,
  text: string,
  caret: number | undefined,
  source: Source,
): Completion | Promise<Completion>
export function complete(
  v: Vocab,
  text: string,
  caret = text.length,
  source: Source = {},
): Completion | Promise<Completion> {
  let from = start(text, caret)
  let line = named(v, `${text.slice(0, from)} ${text.slice(caret)}`)
  let word = text.slice(from, caret)
  let found = offer({ v, line, source }, word)
  return then(found, (cands) => ({ from, to: caret, ...answer(word, cands) }))
}
