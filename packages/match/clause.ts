// One clause of a query to one test over a bundle. This is the routing half:
// where ./value.ts knows how a value compares, this knows what a dotted path
// names — a column on this entity, a component it either has or does not, a
// reference followed to another entity, the children pointing back at it, the
// kind it displays as, or a search term to look for in its text.
//
// Every route is resolved through the vocabulary, never guessed, and the tests
// are built once, when the query is compiled: a path that names no column, a
// comparison a column's type cannot answer, or a directive that needs an index
// is refused there and then, before any bundle is read.

import {
  bare,
  type Clause,
  type Pred,
  type Range,
  type Refs,
  type Value,
  type Walk,
  WALK_LIMIT,
} from '@yaks/query'
import { identity, Unsupported } from '@yaks/sql'
import type { Assoc, Hop, Vocab } from '@yaks/vocab'
import {
  type Bundle,
  column,
  comp,
  type Computed,
  type Index,
  wears,
} from './read.ts'
import { check, EXISTS } from './value.ts'
import { search } from './text.ts'

/** The package name an `Unsupported` error carries, so a refusal reports which
 * of the two evaluators refused. */
export let BY = '@yaks/match'

/**
 * A compiled test: does this bundle satisfy the clause? The whole bundle array
 * is passed along with it, because a reference, a backlink and a reverse hop
 * are questions about other entities.
 */
export type Test = (bundle: Bundle, among: Index) => boolean

/**
 * What a run needs besides the clause: the vocabulary, the reference moment,
 * and the rules that read the vocabulary's computed columns.
 */
export type Ctx = { v: Vocab; now: number; computed: Computed }

let YES: Test = () => true
let NO: Test = () => false

// A structured value flattened back to the single string ./value.ts re-parses —
// a list to `a,b`, a range to `lo..hi` (inclusive) or `lo...hi` (exclusive end).
// ./value.ts splits it again, so the round trip is faithful.
let flat = (val: Value | null): string => {
  if (val == null) return ''
  if (val.kind == 'scalar' || val.kind == 'time') return val.raw
  if (val.kind == 'list') return val.items.map(flat).join(',')
  let r = val as Range
  return `${flat(r.lo)}..${r.exclusiveEnd ? '.' : ''}${flat(r.hi)}`
}

// The operator name ./value.ts switches on: '' equals (and, with an empty
// operand, absence), '!' not-equals, '~' contains, the comparisons unchanged,
// 'exists' presence, 'want' the value-less projection request.
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

// A test over a column read off one entity, or a refusal naming the predicate.
let scalar = (ctx: Ctx, hop: Hop, p: Pred): (b?: Bundle) => boolean => {
  let read = column(ctx.v, hop.comp, hop.prop, ctx.computed)
  if (!read) {
    throw new Unsupported(
      'a computed column',
      `.${hop.comp}.${hop.prop} has no registered rule`,
      BY,
    )
  }
  // A JSON value is compared by nothing yet: presence is the one question
  // asked of it, as @yaks/sql answers it.
  if (read.tag == 'jsonb' && opOf(p) != EXISTS) {
    throw new Unsupported(
      'a filter on it',
      `.${hop.comp}.${hop.prop} holds a JSON value — only its presence ` +
        `(.${hop.comp}.${hop.prop}!) can be asked of it yet`,
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

// A single-hop predicate: a direct column, or a test for the component itself
// (an empty leaf prop, which is the presence form). `.review!` and `.review~=`
// ask for entities that have the component, everything else for those that do
// not.
let single = (ctx: Ctx, hop: Hop, p: Pred): Test => {
  let op = opOf(p)
  if (op == 'want') return YES // a projection request, not a filter
  if (!hop.prop) {
    let present = op == '~' || op == EXISTS
    return (b) => wears(b, hop.comp) == present
  }
  // On the identity component, `=` names entities instead of comparing a
  // column, so it is a set lookup — the same operand list @yaks/sql compiles to
  // `in (?, …)`.
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
  v.prop(hop.comp, hop.prop)?.category == 'ref'

// A dereference path: a chain of one-to-one lookups through reference columns,
// ending in a leaf column tested against the operator. Every hop but the last
// must be a reference, and every step is looked up in the bundle array — an
// entity the array does not hold reads as an absent value, exactly as a missing
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
  // The leaf is a component rather than a column: does the target have it?
  if (!leaf.prop) {
    let present = op == '~' || op == EXISTS
    return (b, among) => {
      let t = follow(b, among)
      return (!!t && wears(t, leaf.comp)) == present
    }
  }
  let hit = scalar(ctx, leaf, p)
  // For the operators only a present value can satisfy, the entity must also
  // have the path's root component. The absent forms skip that check on
  // purpose, so `.maker.title=` selects rows with no maker as well as rows
  // whose maker has no title. @yaks/sql narrows the same predicates the same
  // way (bind.ts, `needsRoot`).
  let rooted = op == EXISTS || ['<', '<=', '>', '>='].includes(op) ||
    ((op == '' || op == '~') && flat(p.value) != '')
  return (b, among) => (!rooted || wears(b, root.comp)) && hit(follow(b, among))
}

// `.kind=K`: the entity has component K and none of the kinds ordered before it
// — that is, K is the most specific kind present. A plural folds to the
// singular (`.kind=reviews` reads as `.kind=review`).
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
// every reference column the vocabulary declares. The presence and absence
// forms are refused: "references anything" is a different question, and
// answering it as a union over all reference columns would not be what the
// query means.
let refs = (ctx: Ctx, r: Refs): Test => {
  if (r.op != '=' || !r.value) {
    throw new Unsupported('.refs', 'only .refs=<id> is answered', BY)
  }
  let cols = ctx.v.refProps()
  return (b, among) =>
    !!among.of(r.value) &&
    cols.some(([c, p]) => comp(b, c)?.[p] === r.value)
}

// The walk, in memory: `.cites[<=3]->p1` selects the bundles that reach the
// target in at most `depth` hops; `<-` selects the bundles the target reaches.
// A hop is one (from, to) pair, and a bundle can supply one in three ways — an
// edge entity, which has the relation's tag component alongside `edge{from,to}`
// (`cites {}` beside `edge`); an entity's own reference column (`fork.from`
// reads as this entity → the entry); or a chain of reference columns composed
// into one pair (`fork.from.session` reads as this entity → the session of the
// entry it forked from). All three are resolved through the same vocabulary
// @yaks/edge and @yaks/sql read. The closure is one breadth-first traversal per
// bundle array, capped at the same row count as the recursive CTE @yaks/sql
// emits, then a set lookup per candidate; the target itself is selected only
// when a cycle leads back to it.
let relation = (v: Vocab, name: string): string | undefined =>
  v.comp('edge') && v.all.find((tag) => {
    let kw = v.comp(tag)?.keywords
    let said = kw?.edge ?? kw?.relation
    return said === true ? tag == name : said === name
  })

type Step = (b: Bundle, among: Index) => [string, string] | undefined
let stepOf = (ctx: Ctx, w: Walk): Step => {
  let spelled = `.${w.path.join('.')}`
  let tag = w.path.length == 1 ? relation(ctx.v, w.path[0]) : undefined
  if (tag) {
    return (b) => {
      let e = wears(b, tag) ? comp(b, 'edge') : undefined
      return typeof e?.from == 'string' && typeof e?.to == 'string'
        ? [e.from, e.to]
        : undefined
    }
  }
  let hops: Hop[] = []
  try {
    hops = ctx.v.aim(w.path.join('.'))
  } catch { /* an unknown word: refused below */ }
  if (!hops.length || !hops.every((h) => h.prop && isRef(ctx.v, h))) {
    throw new Unsupported(
      'a walk',
      `${spelled} is neither a relation nor a chain of reference columns`,
      BY,
    )
  }
  // A chain follows one reference to the next, each link read off the bundle
  // the previous one named: a link the array does not hold produces no pair,
  // exactly as a missing join row drops it from the set of hops.
  return (b, among) => {
    let eid = comp(b, hops[0].comp)?.[hops[0].prop]
    for (let h of hops.slice(1)) {
      if (typeof eid != 'string') return undefined
      let next = among.of(eid)
      eid = next && comp(next, h.comp)?.[h.prop]
    }
    return typeof eid == 'string' ? [b.entity.eid, eid] : undefined
  }
}

let walk = (ctx: Ctx, w: Walk): Test => {
  let step = stepOf(ctx, w)
  let [here, there] = w.dir == '->' ? [1, 0] : [0, 1]
  let id = identity('eid', w.target)
  let reached = new WeakMap<Index, Set<string>>()
  let closure = (among: Index): Set<string> => {
    let out = new Set<string>()
    let t = among.of(w.target) ??
      among.list.find((b) =>
        b.entity.num != null && id?.nums.includes(b.entity.num)
      )
    if (!t) return out
    let pairs = among.list.flatMap((b) => {
      let p = step(b, among)
      return p ? [p] : []
    })
    if (w.depth == null) {
      let adj = new Map<string, string[]>()
      for (let p of pairs) {
        let next = adj.get(p[here])
        if (!next) adj.set(p[here], next = [])
        next.push(p[there])
      }
      let queue = [t.entity.eid]
      let seen = new Set(queue)
      for (let i = 0; i < queue.length; i++) {
        for (let e of adj.get(queue[i]) ?? []) {
          if (seen.has(e)) continue
          seen.add(e)
          queue.push(e)
          out.add(e)
          if (out.size == WALK_LIMIT) return out
        }
      }
      return out
    }
    let frontier = new Set([t.entity.eid])
    for (let d = 0; d < w.depth && frontier.size; d++) {
      let next = new Set<string>()
      for (let p of pairs) {
        if (frontier.has(p[here]) && !out.has(p[there])) next.add(p[there])
      }
      for (let e of next) out.add(e)
      frontier = next
    }
    return out
  }
  return (b, among) => {
    let hit = reached.get(among)
    if (!hit) reached.set(among, hit = closure(among))
    return hit.has(b.entity.eid)
  }
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

// A reverse hop: the entities whose child rows point back at them, named by the
// vocabulary's derived association (`.reviews` = the reviews whose `product` is
// this entity). `.reviews!` tests for at least one, `.reviews=` for none,
// `.reviews>=5` counts them, and `.reviews.stars=5` asks whether any child
// matches. A child predicate goes through the same clause compiler, over the
// child bundle, so anything refused there refuses the whole hop.
let reverse = (ctx: Ctx, name: string, a: Assoc, p: Pred): Test => {
  let kids = (b: Bundle, among: Index): Bundle[] =>
    among.list.filter((k) => comp(k, a.comp)?.[a.prop] === b.entity.eid)
  let rest = p.path.slice(1)
  let value = flat(p.value)
  if (!rest.length && !p.where) {
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
  // Inside the hop the identity component names the child, not the entity being
  // tested, so a child predicate that reached it would silently ask a different
  // question.
  if (
    rest.length && ctx.v.aim(rest.join('.')).some((h) => h.comp == 'entity')
  ) {
    throw new Unsupported(
      'a reverse hop through the spine',
      `.${name}.${rest.join('.')}`,
      BY,
    )
  }
  let inner = clause(ctx, p.where ?? { ...p, path: rest, not: undefined })
  return (b, among) => kids(b, among).some((k) => inner(k, among)) != !!p.not
}

// A bare word: a search over the entity's text. Every stored text column of
// every component the entity has is searched — the same fields a full-text
// index covers by default.
let words = (ctx: Ctx, value: string): Test => {
  let hit = search(value)
  if (!hit) return NO
  let fields = ctx.v.all.flatMap((c) =>
    ctx.v.props(c)
      .map((p) => ctx.v.prop(c, p)!)
      .filter((col) =>
        !col.computed && col.category == 'scalar' && col.scalar == 'text'
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
  if (c.kind == 'walk') return walk(ctx, c)
  if (c.kind == 'pred') {
    if (c.path[0] == 'kind' && c.path.length == 1) {
      return kindScope(ctx, flat(c.value))
    }
    // A plural at the head of the path is a reverse association, read from the
    // far side of a reference; anything else is resolved forward through the
    // vocabulary.
    let assoc = ctx.v.assoc(c.path[0])
    if (assoc) return reverse(ctx, c.path[0], assoc, c)
    if (c.not || c.where) {
      throw new Unsupported('a reverse association', c.path.join('.'), BY)
    }
    let hops = c.facet
      ? [
        ...(c.path.length > 1 ? ctx.v.aim(c.path.slice(0, -1).join('.')) : []),
        { comp: c.path.at(-1)!, prop: '' },
      ]
      : ctx.v.aim(c.path.join('.'), bare(c))
    return hops.length == 1 ? single(ctx, hops[0], c) : path(ctx, hops, c)
  }
  throw new Unsupported(`the ${(c as Clause).kind} directive`, '', BY)
}
