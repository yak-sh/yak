// One clause of a query to one test over a bundle. This is the routing half:
// where ./value.ts knows how a VALUE compares, this knows what a dotted path
// NAMES — a column on this entity, a component it either wears or does not, a
// reference followed to another entity, the children pointing back at it, the
// kind it displays as, or a word to look for in its text.
//
// Every route is asked of the vocabulary, never guessed, and the tests are
// built ONCE, when the query is compiled: a path that names no column, a
// comparison a column's type cannot answer, or a directive that needs an index
// is refused there and then, before any bundle is read.

import type { Bundle } from '@yaks/graph'
import type { Clause, Pred, Range, Refs, Value } from '@yaks/query'
import { identity, Unsupported } from '@yaks/sql'
import type { Assoc, Hop, Vocab } from '@yaks/vocab'
import { column, comp, type Index, wears } from './read.ts'
import { check, EXISTS } from './value.ts'
import { search } from './text.ts'

/** The name this package declines under, so a refusal says who refused. */
export let BY = '@yaks/match'

/**
 * A compiled test: does this bundle satisfy the clause? The whole bundle set
 * rides along, because a reference, a backlink and a reverse hop are questions
 * about other entities.
 */
export type Test = (bundle: Bundle, among: Index) => boolean

/** What a run needs besides the clause: the vocabulary and the reference moment. */
export type Ctx = { v: Vocab; now: number }

let YES: Test = () => true
let NO: Test = () => false

// A structured value flattened back to the one string the value lowerings
// re-parse — a list to `a,b`, a range to `lo..hi` (inclusive) or `lo...hi`
// (exclusive end). The lowerings split it again, so the round trip is faithful.
let flat = (val: Value | null): string => {
  if (val == null) return ''
  if (val.kind == 'scalar' || val.kind == 'time') return val.raw
  if (val.kind == 'list') return val.items.map(flat).join(',')
  let r = val as Range
  return `${flat(r.lo)}..${r.exclusiveEnd ? '.' : ''}${flat(r.hi)}`
}

// The operator spelling the value lowerings switch on: '' equals (and, with an
// empty operand, absence), '!' not-equals, '~' contains, the comparisons
// literal, 'exists' presence, 'want' the value-less projection request.
let opOf = (p: Pred): string =>
  p.op == '!'
    ? EXISTS
    : p.op == '?'
    ? 'want'
    : p.op == '='
    ? ''
    : p.op == '!='
    ? '!'
    : p.op == '~='
    ? '~'
    : p.op

// A test over a column read off one entity, or a decline naming the predicate.
let scalar = (ctx: Ctx, hop: Hop, p: Pred): (b?: Bundle) => boolean => {
  let read = column(ctx.v, hop.comp, hop.prop)
  if (!read) {
    throw new Unsupported(
      'a computed column',
      `.${hop.comp}.${hop.prop} has no value to read`,
      BY,
    )
  }
  let hit = check(opOf(p), flat(p.value), read.tag, ctx.now)
  if (!hit) {
    throw new Unsupported(
      'this predicate',
      `.${hop.comp}.${hop.prop} ${p.op}`,
      BY,
    )
  }
  return (b) => hit(b ? read.read(b) : null)
}

// A single-hop predicate: a direct column, or a component facet (an empty leaf
// prop — presence grammar). `.review!` and `.review~=` ask for the component,
// everything else asks for its absence.
let single = (ctx: Ctx, hop: Hop, p: Pred): Test => {
  let op = opOf(p)
  if (op == 'want') return YES // a projection request, not a filter
  if (!hop.prop) {
    let present = op == '~' || op == EXISTS
    return (b) => wears(b, hop.comp) == present
  }
  // On the spine, `=` NAMES entities instead of comparing a column, so it is a
  // set lookup — the same operand list @yaks/sql lowers to `in (?, …)`.
  if (hop.comp == 'entity' && op == '') {
    let set = identity(hop.prop, flat(p.value))
    if (set) {
      let eids = new Set(set.eids)
      let nums = new Set(set.nums)
      return (b) =>
        eids.has(b.entity.eid) ||
        (b.entity.num != null && nums.has(b.entity.num))
    }
  }
  let hit = scalar(ctx, hop, p)
  return (b) => hit(b)
}

let isRef = (v: Vocab, hop: Hop) =>
  v.column(hop.comp, hop.prop)?.category == 'ref'

// A reference-deref path: a chain of one-to-one lookups through reference
// columns, ending in a leaf tested against the operator. Every non-final hop
// must be a reference, and every step is resolved inside the bundle set — an
// entity the set does not hold reads as an absent value, exactly as a missing
// row does.
let path = (ctx: Ctx, hops: Hop[], p: Pred): Test => {
  let op = opOf(p)
  if (op == 'want') return YES
  let root = hops[0]
  for (let h of hops.slice(0, -1)) {
    if (!isRef(ctx.v, h)) {
      throw new Unsupported(
        'a path',
        `.${h.comp}.${h.prop} is not a reference`,
        BY,
      )
    }
  }
  let follow = (b: Bundle, among: Index): Bundle | undefined => {
    let eid = comp(b, root.comp)?.[root.prop]
    for (let h of hops.slice(1, -1)) {
      if (typeof eid != 'string') return undefined
      let next = among.of(eid)
      eid = next && comp(next, h.comp)?.[h.prop]
    }
    return typeof eid == 'string' ? among.of(eid) : undefined
  }
  let leaf = hops[hops.length - 1]
  // A leaf facet: does the target wear this component?
  if (!leaf.prop) {
    let present = op == '~' || op == EXISTS
    return (b, among) => {
      let t = follow(b, among)
      return (!!t && wears(t, leaf.comp)) == present
    }
  }
  let hit = scalar(ctx, leaf, p)
  // The narrowing a rooted path keeps: the entity must wear the root component.
  // Without it, `.maker.title=` (absent) would also select rows with no maker.
  let rooted = op == EXISTS || ['<', '<=', '>', '>='].includes(op) ||
    ((op == '' || op == '~') && flat(p.value) != '')
  return (b, among) => (!rooted || wears(b, root.comp)) && hit(follow(b, among))
}

// `.kind=K`: the entity wears K and every kind that sorts before it is absent —
// "K is the most specific kind present". A plural folds in (`.kind=reviews`
// reads as `.kind=review`).
let kindScope = (ctx: Ctx, value: string): Test => {
  let kinds = ctx.v.kinds
  let k = kinds.includes(value)
    ? value
    : value.endsWith('s') && kinds.includes(value.slice(0, -1))
    ? value.slice(0, -1)
    : null
  if (!k) throw new Unsupported('.kind', `${value} names no kind`, BY)
  let earlier = kinds.slice(0, kinds.indexOf(k))
  return (b) => wears(b, k) && earlier.every((e) => !wears(b, e))
}

// `.refs=X`: the backlinks of X — every entity holding a reference to it, over
// every reference column the vocabulary declares. Presence and absence forms
// decline: "references anything" is a different question, and answering it as a
// union of columns would say something the grammar does not mean.
let refs = (ctx: Ctx, r: Refs): Test => {
  if (r.op != '=' || !r.value) {
    throw new Unsupported('.refs', 'only .refs=<id> is answered', BY)
  }
  let cols = ctx.v.refCols()
  return (b, among) =>
    !!among.of(r.value) &&
    cols.some(([c, p]) => comp(b, c)?.[p] === r.value)
}

// The operators a cardinality test compares its count with.
let COUNTS: Record<string, string> = {
  '=': '=',
  '!=': '!=',
  '<': '<',
  '<=': '<=',
  '>': '>',
  '>=': '>=',
}
let counted = (n: number, op: string, m: number): boolean =>
  op == '='
    ? n == m
    : op == '!='
    ? n != m
    : op == '<'
    ? n < m
    : op == '<='
    ? n <= m
    : op == '>'
    ? n > m
    : n >= m

// A REVERSE HOP: the entities whose child rows point back at them, named by the
// vocabulary's derived association (`.reviews` = the reviews whose `product` is
// this entity). `.reviews!` is presence, `.reviews=` absence, `.reviews>=5` a
// cardinality test, and `.reviews.stars=5` an existential over a filtered child.
// A child filter rides the SAME clause compiler over the child bundle, so
// anything that declines there declines the whole hop.
let reverse = (ctx: Ctx, name: string, a: Assoc, p: Pred): Test => {
  let kids = (b: Bundle, among: Index): Bundle[] =>
    among.list.filter((k) => comp(k, a.comp)?.[a.prop] === b.entity.eid)
  let rest = p.path.slice(1)
  let value = flat(p.value)
  if (!rest.length) {
    if (p.op == '!' || (p.op == '~=' && !value)) {
      return (b, among) => kids(b, among).length > 0
    }
    if (p.op == '=' && !value) return (b, among) => kids(b, among).length == 0
    let op = COUNTS[p.op]
    if (!op || !/^\d+$/.test(value)) {
      throw new Unsupported(
        'a reverse hop',
        `.${name}${p.op}${value} is neither a count nor a child filter`,
        BY,
      )
    }
    let n = Number(value)
    return (b, among) => counted(kids(b, among).length, op, n)
  }
  // Inside the hop the spine names the CHILD, not the entity being tested, so a
  // child predicate that reaches it would silently ask a different question.
  if (ctx.v.aim(rest.join('.')).some((h) => h.comp == 'entity')) {
    throw new Unsupported(
      'a reverse hop through the spine',
      `.${name}.${rest.join('.')}`,
      BY,
    )
  }
  let inner = clause(ctx, { ...p, path: rest })
  return (b, among) => kids(b, among).some((k) => inner(k, among))
}

// A bare word: the entity's text, searched. Every stored text-shaped column of
// every component it wears is searchable — the same fields a full-text index
// covers by default.
let words = (ctx: Ctx, value: string): Test => {
  let hit = search(value)
  if (!hit) return NO
  let fields = ctx.v.all.flatMap((c) =>
    ctx.v.columns(c)
      .map((p) => ctx.v.column(c, p)!)
      .filter((col) =>
        col.persist && col.category == 'scalar' && col.scalar == 'text'
      )
      .map((col) => [c, col.prop] as [string, string])
  )
  return (b) =>
    fields.some(([c, p]) => {
      let v = comp(b, c)?.[p]
      return typeof v == 'string' && hit(v)
    })
}

/**
 * Compile one filter clause into a test. Directives are read off the query
 * before this runs; anything left that this package cannot answer exactly
 * throws {@link Unsupported} here, at compile time.
 */
export let clause = (ctx: Ctx, c: Clause): Test => {
  if (c.kind == 'never') return NO
  if (c.kind == 'text') return words(ctx, c.value)
  if (c.kind == 'and') {
    let ts = c.clauses.map((x) => clause(ctx, x))
    return (b, among) => ts.every((t) => t(b, among))
  }
  if (c.kind == 'or') {
    let ts = c.clauses.map((x) => clause(ctx, x))
    return (b, among) => ts.some((t) => t(b, among))
  }
  if (c.kind == 'refs') return refs(ctx, c)
  if (c.kind == 'pred') {
    if (c.path[0] == 'kind' && c.path.length == 1) {
      return kindScope(ctx, flat(c.value))
    }
    // A plural leading the path is a reverse association, read from the far
    // side; anything else routes forward through the vocabulary.
    let assoc = ctx.v.assoc(c.path[0])
    if (assoc) return reverse(ctx, c.path[0], assoc, c)
    let hops = ctx.v.aim(c.path.join('.'))
    return hops.length == 1 ? single(ctx, hops[0], c) : path(ctx, hops, c)
  }
  throw new Unsupported(`the ${(c as Clause).kind} directive`, '', BY)
}
