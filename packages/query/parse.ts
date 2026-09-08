// The generic parser: a yaks query STRING to the AST. It knows the format —
// the sigils that mark a component word, the operators, list/range value forms,
// the reserved directives, how `&`, `,`, whitespace and quotes separate tokens
// — and nothing about any schema. Where a meaning needs the vocabulary (which
// component a bare `.status` routes to, whether a scalar is a time phrase or a
// plain word, whether `.comments` names a reverse association), the parser keeps
// the raw tokens and leaves the reading to a downstream compiler. See README for
// the full handoff.
//
// A token is one of three things BY ITS OWN SHAPE, so nothing is ever read by
// trying and failing: a component clause (it wears a sigil, or it carries an
// operator), a quoted text term, or a bare word, which is a text term. A
// malformed clause — a directive with the wrong operand, two presence filters
// mashed together — throws where it is read; it never falls back to text.
//
// The mirror of the builders in ast.ts: `parse('.a=1&.b=2')` deep-equals
// `and(eq('a', '1'), eq('b', '2'))`.

import { And, Clause, every, Op, scalar, text, Value } from './ast.ts'

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

// A whole value: a comma list is any-of; a lone part is its atom. Members are
// trimmed and an empty one dropped, so `open, wip` and a trailing comma left by
// the clause split (`.status=open, .p=1`) say what they look like they say.
let value = (raw: string): Value => {
  if (!raw.includes(',')) return atom(raw)
  let items = raw.split(',').map((s) => s.trim()).filter(Boolean)
  return items.length > 1
    ? { kind: 'list', items: items.map(atom) }
    : atom(items[0] ?? raw)
}

// ---- component words ----

// The shape a component clause names: dotted segments of letters. A token that
// is not this shape is a value or a word, never a path.
let WORD = '[A-Za-z_-]+(?:\\.[A-Za-z_-]+)*'
// A prefix SIGIL and the word it marks. `.` is the neutral one and stays
// accepted before any other, so `+!created` and `+!.created` say the same thing.
let SIGIL = new RegExp(`^(\\+!|[!+*#$])\\.?(${WORD})$`)
// A component word alone, dot-marked: present. The dot is what tells `.env`
// (this entity wears `env`) from `env` (the word, searched for).
let PLAIN = new RegExp(`^\\.(${WORD})$`)
// The same word with no mark at all, which a comma can still put in query
// position (`!foo, bar` asks for two components).
let BARE = new RegExp(`^${WORD}$`)

// ---- directive helpers ----

let path = (raw: string): string[] => raw.split('.')

// `.reaches[requires,<=3]=T-42` — the bracket carries what a dot-param cannot:
// which edge type and how far. The cap is required by the shape.
let REACH = /^reaches\[([A-Za-z_]+)\s*,\s*<=\s*(\d+)\]=(.*)$/s
// `.edges[referenced,entry.session]!` — one stored edge type, optional endpoint.
let EDGE_SELECT =
  /^edges\[([A-Za-z_]+)(?:\s*,\s*([A-Za-z_-]+(?:\.[A-Za-z_-]+)*))?\]!$/s
let DOT = new RegExp(`^\\.?(${WORD})(!=|~=|<=|>=|<|>|=|!|\\?)(.*)$`, 's')

// The reserved words whose whole meaning is presence, so the dot-marked
// spelling says the same thing as the older bang (`.count` = `.count!`).
let PRESENCE: Record<string, Clause> = {
  count: { kind: 'count' },
  edges: { kind: 'edges', peers: [] },
  refs: { kind: 'refs', op: '!', value: '' },
}

// A component word wearing a sigil, or null when the token wears none. `!comp`
// and `.comp` are ordinary predicates — absence and presence are questions any
// evaluator answers from data — and the other four are the rule's own words.
let sigil = (token: string): Clause[] | null => {
  let plain = token.match(PLAIN)
  if (plain) return [PRESENCE[plain[1]] ?? pres(plain[1])]
  let m = token.match(SIGIL)
  if (!m) return null
  let [, mark, word] = m
  if (mark == '!') {
    return [{ kind: 'pred', path: path(word), op: '=', value: scalar('') }]
  }
  if (mark == '+') return [{ kind: 'ensure', comp: word }]
  if (mark == '+!') return [{ kind: 'gate', comp: word }]
  if (mark == '*') return [{ kind: 'mutable', comp: word }]
  if (mark == '#') return [{ kind: 'resource', comp: word }]
  return [{ kind: 'var', name: word }]
}

let pres = (word: string): Clause => ({
  kind: 'pred',
  path: path(word),
  op: '!',
  value: null,
})

// One TOKEN to the clauses it contributes, or null when its shape is no clause
// at all (a bare word) — a text term to whoever called. A directive is one
// clause; an ordinary predicate is one clause too.
export let parseDot = (token: string): Clause[] | null => {
  let marked = sigil(token)
  if (marked) return marked
  // The `.` prefix is accepted everywhere and required nowhere: it keeps a URL
  // query string's filters apart from its `page` and `per`, and a rule that
  // never travels in a URL may drop it.
  let raw = token.startsWith('.') ? token.slice(1) : token
  // Bracket forms answer first: a malformed one would fall through to a bare
  // text term and silently search for the traversal the caller meant.
  if (raw.startsWith('reaches[')) {
    let m = raw.match(REACH)
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
  if (raw.startsWith('edges[')) {
    let m = raw.match(EDGE_SELECT)
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
      '.refs takes an id (.refs=T-3), presence (.refs) or absence (!refs)',
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
      '.edges rides a query (.edges) and may project the far endpoint ' +
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

// A token that has already taken an operator, so every comma after it is part
// of its VALUE rather than a separator.
let VALUED = new RegExp(
  `^\\.?(?:${WORD}(?:!=|~=|<=|>=|<|>|=)|(?:reaches|edges)\\[)`,
)

// The clause parts of one token. `,` between clauses is AND; `,` inside a value
// is any-of, and POSITION is what tells them apart: commas separate until a
// clause takes an operator, and from there the rest of the token is that
// clause's value (`entity,+!created` is two clauses, `.p=a,b` is one).
let parts = (tok: string): string[] => {
  let out: string[] = []
  for (let p of tok.split(',')) {
    if (out.length && VALUED.test(out[out.length - 1])) {
      out[out.length - 1] += ',' + p
    } else out.push(p)
  }
  return out.filter(Boolean)
}

/** What a parse may say about the query it is reading. */
export type ParseOpts = {
  /** whether a bare word is a full-text term (default true). A rule, or a saved
   * filter that must not quietly change meaning, passes `false`: a stray word
   * is then refused rather than becoming a search term nobody asked for. */
  text?: boolean
}

// One token to its clauses. `q` marks a token a COMMA put in query position:
// the comma announces another clause, so a bare word there is the component it
// names rather than a word to search for.
let read = (tok: string, q: boolean, opts: ParseOpts): Clause[] => {
  if (tok == '*') return [every()]
  if (!tok.startsWith('"')) {
    let cs = parseDot(tok)
    if (cs) return cs
    // A comma announced a clause, so the word names a component.
    if (q && BARE.test(tok)) return [pres(tok)]
    if (q || opts.text === false) {
      throw new Error(
        `a query takes clauses, not words: ${tok} — quote it to search for it`,
      )
    }
  }
  return [text(stripQuotes(tok))]
}

/**
 * A query string to its AST. `&` separates first — an `&`-segment that IS one
 * dot-param keeps its spaces (`.title~=two words` survives) — and a segment
 * holding bare words or several clauses splits on whitespace and on the commas
 * between clauses, mixing filters and text terms the way a search box does.
 *
 * A LONE `*` is the widest projection, not a word: it asks for every component
 * of every row selected. Only the whole token means it — a trailing `*` on a
 * word (`lemo*`) is still the full-text prefix term it always was.
 *
 * The empty query selects NOTHING: an empty string, or one with no clauses,
 * yields a lone `never`, so a blank board query does not stage the whole graph.
 */
export let parse = (q: string, opts: ParseOpts = {}): And => {
  let out: Clause[] = segments(q).map((s) => s.trim()).filter(Boolean).flatMap(
    (seg) => {
      // A segment that is ONE clause keeps its spaces, so a value may hold them.
      if (!/\s\./.test(seg) && parts(seg).length == 1) {
        let cs = parseDot(seg)
        if (cs) return cs
      }
      let cs: Clause[] = []
      let after = false // the token before this one ended in a comma
      for (let w of words(seg)) {
        let ps = parts(w)
        let joined = ps.length > 1 || w.startsWith(',') || w.endsWith(',')
        ps.forEach((p, i) =>
          cs.push(...read(p, joined || (after && i == 0), opts))
        )
        after = w.endsWith(',')
      }
      return cs
    },
  )
  return { kind: 'and', clauses: out.length ? out : [{ kind: 'never' }] }
}
