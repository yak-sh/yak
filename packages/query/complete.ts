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
// property.
//
// A bare property is offered the way the query will be read: by the
// vocabulary alone (@yaks/vocab's `route`), and where several components
// declare it, by the rest of the line (./meant.ts), so `.task .status=` offers
// a task's statuses and a bare `.status` is offered only where the line says
// whose. A name the vocabulary never lets stand bare (a `_` component's
// properties, one marked `bare: false`) is reached through its component.
//
// What only a graph can answer — the entities a reference could name, the
// values a property holds — comes from a source the caller supplies, so this
// file stays pure. A source that answers with a promise makes the whole answer
// a promise; one that answers at once keeps it synchronous.

import { Ambiguous, type Hop, type Vocab } from '@yaks/vocab'
import { DIRECTIVES, OPERATORS } from './teach.ts'
import { parse, valued } from './parse.ts'
import { about, qualify } from './meant.ts'

/** One thing that could be typed: the word as it reads once taken, and where
 * it comes from. */
export type Cand = { text: string; kind: string }

/** The candidates for the word from `from` to the caret (`to`); taking one
 * replaces that span with its text. */
export type Completion = { from: number; to: number; cands: Cand[] }

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

type At = { v: Vocab; within: Set<string>; source: Source }

let then = <A, B>(x: A | Promise<A>, f: (a: A) => B): B | Promise<B> =>
  x instanceof Promise ? x.then(f) : f(x)

let starts = (s: string, pre: string) =>
  s.toLowerCase().startsWith(pre.toLowerCase())

// Candidates that extend what was typed, never the word itself.
let fits = (words: Cand[], pre: string): Cand[] =>
  words.filter((c) => starts(c.text, pre) && c.text != pre)

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

// The components the rest of the line names outright, which decide what an
// ambiguous bare name means. A line that does not parse yet names none.
let context = (v: Vocab, rest: string): Set<string> => {
  try {
    return about(v, parse(rest).clauses)
  } catch {
    return new Set()
  }
}

// Every name that stands bare, and the components it can mean: one, `''` for a
// reference several components share, or several for the line to choose from.
// Read once per vocabulary.
let bared = new WeakMap<Vocab, Map<string, string[]>>()
let bares = (v: Vocab): Map<string, string[]> => {
  let got = bared.get(v)
  if (got) return got
  got = new Map()
  for (let comp of v.all) {
    for (let prop of v.props(comp)) {
      if (got.has(prop)) continue
      try {
        let hop = v.route(prop)
        if (hop.prop) got.set(prop, [hop.comp])
      } catch (e) {
        if (e instanceof Ambiguous) got.set(prop, e.comps)
      }
    }
  }
  bared.set(v, got)
  return got
}

// The component a bare name means where `within` holds the components in
// play, or undefined where it cannot stand alone there.
let owner = (
  v: Vocab,
  name: string,
  within: Set<string>,
): string | undefined => {
  let comps = bares(v).get(name)
  if (!comps) return undefined
  if (comps.length == 1) return comps[0]
  let picked = comps.filter((c) => within.has(c))
  return picked.length == 1 ? picked[0] : undefined
}

// Past a reference the path reads another row, so the line decides nothing.
let NONE = new Set<string>()

// A property's label: its component, and what it is when that matters.
let mark = (v: Vocab, comp: string, prop: string): string => {
  if (!comp) return 'ref'
  let p = v.prop(comp, prop)
  return p?.category == 'ref'
    ? `${comp} · ref`
    : p?.stamped
    ? `${comp} · stamped`
    : comp
}

let ref = (v: Vocab, hop: Hop): boolean =>
  !hop.comp || v.prop(hop.comp, hop.prop)?.category == 'ref'

// Where a settled path leaves the next segment: on a component, which offers
// its own properties; past a reference (or at the head of a line), where
// anything an entity carries can follow; or nowhere. The walk is @yaks/vocab's
// `aim` taken one step at a time, since the last segment is still being
// typed: a component with a segment after it is the explicit `comp.prop`
// form, and any other segment is a bare name.
type Next = { comp: string } | { far: Set<string> } | null
let next = (at: At, segs: string[]): Next => {
  if (!segs.length) return { far: at.within }
  let hop: Hop | undefined
  for (let i = 0; i < segs.length;) {
    if (hop && !ref(at.v, hop)) return null
    let seg = segs[i]
    if (at.v.comp(seg)) {
      if (i + 1 == segs.length) return { comp: seg }
      if (!at.v.props(seg).includes(segs[i + 1])) return null
      hop = { comp: seg, prop: segs[i + 1] }
      i += 2
    } else if (i == 0 && at.v.assoc(seg)) {
      // A reverse association at the head reads its children from here on.
      i += 1
    } else {
      let comp = owner(at.v, seg, i ? NONE : at.within)
      if (comp == null) return null
      hop = { comp, prop: seg }
      i += 1
    }
  }
  return !hop || ref(at.v, hop) ? { far: NONE } : null
}

// A `_` component describes the vocabulary itself (`_comp`, `_prop`), so it
// follows the application's own components.
let inner = (a: string, b: string): number =>
  Number(a.startsWith('_')) - Number(b.startsWith('_')) || (a < b ? -1 : 1)

// The names that can follow `lead` (a prefix character and the settled
// segments), by family: components (`dot` leads on to their properties),
// properties, and the reverse associations a clause may start with.
type Names = { comps: Cand[]; props: Cand[]; reverse: Cand[] }
let names = (
  at: At,
  lead: string,
  segs: string[],
  pre: string,
  dot: boolean,
): Names => {
  let n = next(at, segs)
  let v = at.v
  if (!n) return { comps: [], props: [], reverse: [] }
  if ('comp' in n) {
    let comp = n.comp
    return {
      comps: [],
      props: v.props(comp).filter((p) => starts(p, pre)).toSorted()
        .map((p) => ({ text: lead + p, kind: mark(v, comp, p) })),
      reverse: [],
    }
  }
  let within = n.far
  return {
    comps: v.all.filter((c) => starts(c, pre)).toSorted(inner).map((c) => ({
      text: lead + c + (dot && v.props(c).length ? '.' : ''),
      kind: 'comp',
    })),
    props: [...bares(v).keys()].filter((p) => starts(p, pre)).toSorted()
      .flatMap((p) => {
        let comp = owner(v, p, within)
        return comp == null ? [] : [{ text: lead + p, kind: mark(v, comp, p) }]
      }),
    reverse: segs.length ? [] : v.assocs()
      .filter(([name]) => starts(name, pre))
      .toSorted(([a], [b]) => a.localeCompare(b))
      .map(([name, a]) => ({ text: lead + name, kind: `${a.comp} · reverse` })),
  }
}

// After a whole property, the operators, and a range to fill in.
let ops = (word: string): Cand[] => [
  ...OPERATORS.map((o) => ({ text: word + o.spell, kind: o.word })),
  { text: word + '=..', kind: 'range' },
]

// A component alone is its own presence test; what it completes to is the
// other questions about it, each a prefix form.
let presence = (name: string): Cand[] => [
  { text: '!' + name, kind: 'absent' },
  { text: '?' + name, kind: 'wanted' },
]

// The whole word, when it already names something, and what may follow it.
let exact = (at: At, segs: string[], name: string, word: string): Cand[] => {
  let n = next(at, segs)
  if (!n || !name) return []
  if ('comp' in n) return at.v.props(n.comp).includes(name) ? ops(word) : []
  if (owner(at.v, name, n.far) != null) return ops(word)
  return !segs.length && at.v.comp(name) ? presence(name) : []
}

// The directives written as a dotted name: `.order=`, `.count`, `.limit=`.
let directives = (pre: string): Cand[] =>
  DIRECTIVES.filter((d) =>
    d.spell.startsWith('.') && starts(d.spell.slice(1), pre)
  ).map((d) => ({ text: d.spell, kind: d.word }))

// A path being typed: `.sta`, `.task.`, `.assignee.ti`, `!propo`, `?lo`.
let path = (at: At, word: string, sigil: string, dotted: string): Cand[] => {
  let segs = dotted.split('.')
  let pre = segs.pop()!
  let lead = sigil + segs.map((s) => s + '.').join('')
  let n = names(at, lead, segs, pre, sigil == '.' || segs.length > 0)
  if (sigil == '?') return fits(n.comps, word)
  let found = fits([...n.comps, ...n.props, ...n.reverse], word)
  if (sigil == '!') return found
  return [
    ...exact(at, segs, pre, word),
    ...found,
    ...segs.length ? [] : fits(directives(pre), word),
  ]
}

// A half-typed operator wants the rest of itself: `.status!` → `.status!=`.
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
  if (!hop.comp || hop.prop == 'eid') return ids(at, 'entity', pre)
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

// A property path as a directive's value (`.tally=status`, `.fields=pin.x`),
// the properties first, since a component alone is no value there.
let field = (at: At, typed: string): Cand[] => {
  let segs = typed.split('.')
  let pre = segs.pop()!
  let lead = segs.map((s) => s + '.').join('')
  let n = names(at, lead, segs, pre, true)
  return fits(
    [...n.props, ...n.comps.filter((c) => c.text.endsWith('.'))],
    typed,
  )
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
    hops = at.v.aim(qualify(at.v, segs, at.within).join('.'))
  } catch {
    return []
  }
  let leaf = hops[hops.length - 1]
  if (!leaf.prop || hops.slice(0, -1).some((h) => !ref(at.v, h))) return []
  return then(
    slot(at, leaf, pre),
    (found) =>
      found.filter((c) => c.text && c.text != pre)
        .map((c) => ({ ...c, text: lead + c.text })),
  )
}

let SEG = '[A-Za-z_]+(?:-[A-Za-z_]+)*'
let DOTTED = `${SEG}(?:\\.${SEG})*`
let VALUE = new RegExp(`^\\.?(${DOTTED})(!=|~=|<=|>=|<|>|=)(.*)$`, 's')
let HALF = new RegExp(`^\\.${DOTTED}([!~])$`)
let PATH = new RegExp(`^([.!?])((?:${SEG}\\.)*[A-Za-z_-]*)$`)

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
 * complete(v, '.status=o')
 * // { from: 0, to: 9, cands: [{ text: '.status=open', kind: 'status' }] }
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
  let within = context(v, `${text.slice(0, from)} ${text.slice(caret)}`)
  let found = offer({ v, within, source }, text.slice(from, caret))
  return then(found, (cands) => ({ from, to: caret, cands }))
}
