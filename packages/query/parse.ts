// The generic parser: a yaks query STRING to the AST. It knows the format —
// the operators, list/range value forms, the reserved directives, how `&` and
// whitespace and quotes separate tokens — and nothing about any schema. Where a
// meaning needs the vocabulary (which component a bare `.status` routes to,
// whether a scalar is a time phrase or a plain word, whether `.comments` names
// a reverse association), the parser keeps the raw tokens and leaves the reading
// to a downstream compiler. See README for the full handoff.
//
// The mirror of the builders in ast.ts: `parse('.a=1&.b=2')` deep-equals
// `and(eq('a', '1'), eq('b', '2'))`.

import { And, Clause, Op, scalar, text, Value } from './ast.ts'

// ---- values ----

let stripQuotes = (v: string): string => v.replace(/^"(.*)"$/s, '$1')

// One atom: a range (`x..y`, or `x...y` for an exclusive end) or a scalar. The
// range split is generic — the current matcher applies `..` to every column, so
// recognizing it here needs no type.
let atom = (raw: string): Value => {
  let m = raw.match(/^(.*?)\.\.(\.?)(.*)$/s)
  if (!m) return scalar(raw)
  let [, lo, excl, hi] = m
  return { kind: 'range', lo: scalar(lo), hi: scalar(hi), exclusiveEnd: !!excl }
}

// A whole value: a comma list is any-of; a lone part is its atom.
let value = (raw: string): Value =>
  raw.includes(',')
    ? { kind: 'list', items: raw.split(',').map(atom) }
    : atom(raw)

// ---- directive helpers ----

let path = (raw: string): string[] => raw.split('.')

// `.reaches[requires,<=3]=T-42` — the bracket carries what a dot-param cannot:
// which edge type and how far. The cap is required by the shape.
let REACH = /^\.reaches\[([A-Za-z_]+)\s*,\s*<=\s*(\d+)\]=(.*)$/s
// `.edges[referenced,entry.session]!` — one stored edge type, optional endpoint.
let EDGE_SELECT =
  /^\.edges\[([A-Za-z_]+)(?:\s*,\s*([A-Za-z_-]+(?:\.[A-Za-z_-]+)*))?\]!$/s
let DOT = /^\.([A-Za-z_-]+(?:\.[A-Za-z_-]+)*)(!=|~=|<=|>=|<|>|=|!|\?)(.*)$/s

// One dot-param TOKEN to the clauses it contributes, or null when the token is
// no dot-param at all (a bare word, an opless `.env`) — a text term to whoever
// called. A directive is one clause; an ordinary predicate is one clause too.
export let parseDot = (token: string): Clause[] | null => {
  // Bracket forms answer first: a malformed one would fall through to a bare
  // text term and silently search for the traversal the caller meant.
  if (token.startsWith('.reaches[')) {
    let m = token.match(REACH)
    if (!m || !m[3]) {
      throw new Error(
        '.reaches names an edge type, a depth cap and an entity: ' +
          '.reaches[requires,<=3]=T-42',
      )
    }
    let depth = Number(m[2])
    if (depth < 1) throw new Error(`.reaches needs at least one hop: <=${m[2]}`)
    return [{ kind: 'reaches', edgeType: m[1], depth, target: m[3] }]
  }
  if (token.startsWith('.edges[')) {
    let m = token.match(EDGE_SELECT)
    if (!m) {
      throw new Error(
        '.edges selects one edge type and an optional endpoint reference: ' +
          '.edges[referenced,entry.session]!',
      )
    }
    return [{
      kind: 'edges',
      peers: [],
      select: { type: m[1], ...(m[2] ? { via: path(m[2]) } : {}) },
    }]
  }

  let m = token.match(DOT)
  if (!m) return null
  let [, pathStr, rawOp, rawValue] = m
  let op = rawOp as Op
  let val = stripQuotes(rawValue)
  let segs = pathStr.split('.')

  // Rankings and the reverse-union: a value or presence, never a filter.
  if (pathStr == 'order' && op == '=') return [{ kind: 'order', value: val }]
  if (pathStr == 'near' && op == '=') return [{ kind: 'near', value: val }]
  if (pathStr == 'refs') {
    if (op == '=') return [{ kind: 'refs', op: '=', value: val }]
    if (op == '!') return [{ kind: 'refs', op: '!', value: '' }]
    throw new Error(
      '.refs takes an id (.refs=T-3), presence (.refs!) or absence (.refs=)',
    )
  }
  // `.count!` — the selection's size, naming no column, so presence is its only
  // spelling.
  if (pathStr == 'count' && op == '!') return [{ kind: 'count' }]
  // `.distinct=col` / `.tally=col` — an aggregate over one column. The column
  // stays raw segments; whether it is one column or an illegal path is schema.
  if (pathStr == 'distinct' || pathStr == 'tally') {
    if (op != '=' || !val) {
      throw new Error(`.${pathStr} names a column: .${pathStr}=domain`)
    }
    return [{ kind: pathStr, path: path(val) }]
  }
  // `.fields=pin.x,pin.z~` — the projection; a trailing `~` mutes a column's
  // wake. Each column stays raw segments.
  if (pathStr == 'fields') {
    if (op != '=' || !val) {
      throw new Error('.fields names columns: .fields=pin.x,pin.y')
    }
    let fields = val.split(',').map((seg) => {
      let wake = !seg.endsWith('~')
      return { path: path(wake ? seg : seg.slice(0, -1)), wake }
    })
    return [{ kind: 'fields', fields }]
  }
  // `.limit=200` / `.after=13882` — the window. A bound that is a guess is
  // worse than none, so a non-integer is refused, not dropped. `.after` names an
  // ENTITY by its spine number, never a position or an order key: an evaluator
  // derives where that entity sits in whatever order the query asked for, so
  // one cursor spelling serves every ordering.
  if (pathStr == 'limit' || pathStr == 'after') {
    if (op != '=' || !/^\d+$/.test(val)) {
      throw new Error(`.${pathStr} takes a whole number: .${pathStr}=200`)
    }
    return [{ kind: pathStr, n: Number(val) }]
  }
  // `.edges!` / `.edges.peers=status,title` — the rider.
  if (segs[0] == 'edges') {
    if (segs.length == 1 && op == '!' && !val) {
      return [{ kind: 'edges', peers: [] }]
    }
    if (segs.length == 2 && segs[1] == 'peers' && op == '=' && val) {
      return [{ kind: 'edges', peers: val.split(',').map(path) }]
    }
    throw new Error(
      '.edges rides a query (.edges!) and may project the far endpoint ' +
        '(.edges.peers=status,title)',
    )
  }

  // Two presence filters run together is a forgotten `&`; the mid-bang reverse
  // reading (`.comments!.author=alice`) is a schema concern (see README), so at
  // this generic layer a bang before more path is that same mistake.
  if (op == '!' && val) {
    throw new Error(
      `presence filters end at !: .${pathStr}!` +
        (val.startsWith('.')
          ? ` — join filters with &: .${pathStr}!&${val}`
          : ''),
    )
  }

  // An ordinary predicate. Presence (`!`) and want (`?`) carry no value;
  // contains (`~=`) is deliberately literal, so its value is one raw scalar;
  // every other form parses list/range structure.
  if (op == '!' || op == '?') {
    return [{ kind: 'pred', path: segs, op, value: null }]
  }
  if (op == '~=') return [{ kind: 'pred', path: segs, op, value: scalar(val) }]
  return [{ kind: 'pred', path: segs, op, value: value(val) }]
}

// ---- tokenizing a whole query ----

// The `&` split, quote-aware: a quoted run is ONE value even across `&`.
let segments = (q: string): string[] => q.match(/(?:"[^"]*"|[^&])+/g) ?? []
// The whitespace split within a segment, quotes gluing a value together.
let words = (seg: string): string[] =>
  seg.match(/[^\s"]+"[^"]*"|"[^"]*"|\S+/g) ?? []

// A query string to its AST. `&` separates first — an `&`-segment that IS one
// dot-param keeps its spaces (`.title~=two words` survives) — and a segment
// holding bare words or an embedded ` .` splits on whitespace, mixing filters
// and text terms the way a search box does.
//
// The empty query selects NOTHING: an empty string, or one with no clauses,
// yields a lone `never`, so a blank board query does not stage the whole graph.
export let parse = (q: string): And => {
  let out: Clause[] = segments(q).map((s) => s.trim()).filter(Boolean).flatMap(
    (seg) => {
      if (seg.startsWith('.') && !/\s\./.test(seg)) {
        let p = parseDot(seg)
        if (p) return p
      }
      return words(seg).flatMap((tok): Clause[] => {
        if (tok.startsWith('.')) {
          let p = parseDot(tok)
          if (p) return p
        }
        return [text(stripQuotes(tok))]
      })
    },
  )
  return { kind: 'and', clauses: out.length ? out : [{ kind: 'never' }] }
}
