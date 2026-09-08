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

// Quotes are double or single, and a backslash inside escapes the next char.
let QUOTED = /^(["'])(.*)\1$/s
let stripQuotes = (v: string): string => {
  let m = v.match(QUOTED)
  return m ? m[2].replace(/\\(.)/gs, '$1') : v
}

// A split on `sep` that leaves quoted runs whole.
let splitOutside = (s: string, sep: string): string[] => {
  let out: string[] = []
  let cur = ''
  let quote = ''
  for (let i = 0; i < s.length; i++) {
    let c = s[i]
    if (quote) {
      cur += c
      if (c == '\\' && i + 1 < s.length) cur += s[++i]
      else if (c == quote) quote = ''
    } else if (c == '"' || c == "'") {
      quote = c
      cur += c
    } else if (c == sep) {
      out.push(cur)
      cur = ''
    } else cur += c
  }
  out.push(cur)
  return out
}

let LIST = 'a list has no spaces and no empty member (.status=open,wip); ' +
  'quote a value with spaces (.status="open wip")'

// One atom: a range (`x..y`, or `x...y` for an exclusive end) or a scalar. The
// range split is generic — the current matcher applies `..` to every column, so
// recognizing it here needs no type.
let atom = (raw: string): Value => {
  let m = raw.match(/^(.*?)\.\.(\.?)(.*)$/s)
  if (!m) return scalar(raw)
  let [, lo, excl, hi] = m
  return { kind: 'range', lo: scalar(lo), hi: scalar(hi), exclusiveEnd: !!excl }
}

// A whole value: a comma list is any-of; a lone part is its atom. A member is
// never empty — `open,,wip` and a trailing comma are refused, not smoothed —
// and a member holding a space was quoted, so the quotes come off here.
let value = (raw: string): Value => {
  let items = splitOutside(raw, ',')
  if (items.length == 1) return atom(raw)
  if (items.some((s) => !s)) throw new Error(LIST)
  return { kind: 'list', items: items.map((s) => atom(stripQuotes(s))) }
}

// ---- component words ----

// The shape a component clause names: dotted segments of letters. A token that
// is not this shape is a value or a word, never a path.
let WORD = '[A-Za-z_-]+(?:\\.[A-Za-z_-]+)*'
// A prefix SIGIL and the word it marks. `.` is the neutral one and stays
// accepted before any other, so `+!created` and `+!.created` say the same thing.
// `?comp` is the prefix mirror of `!comp`: optional (selected when present,
// never filtered on) beside missing.
let SIGIL = new RegExp(`^(\\+!|[!+*#$?])\\.?(${WORD})$`)
// A component word alone, dot-marked: present. The dot is what tells `.env`
// (this entity wears `env`) from `env` (the word, searched for).
let PLAIN = new RegExp(`^\\.(${WORD})$`)

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
  if (mark == '?') {
    return [{ kind: 'pred', path: path(word), op: '?', value: null }]
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

// The token split: whitespace and `&` both end a token, a quoted run is one
// token even across them. A quote OPENS only at a token's start or right after
// an operator, so an apostrophe inside a word (`jeff's`) stays a letter. An
// unclosed quote is refused: the rest of the line was not what the caller
// meant.
let tokens = (q: string): string[] => {
  let out: string[] = []
  let cur = ''
  let quote = ''
  for (let i = 0; i < q.length; i++) {
    let c = q[i]
    if (quote) {
      cur += c
      if (c == '\\' && i + 1 < q.length) cur += q[++i]
      else if (c == quote) quote = ''
    } else if ((c == '"' || c == "'") && /^$|[=<>,]$/.test(cur)) {
      quote = c
      cur += c
    } else if (c == '&' || /\s/.test(c)) {
      if (cur) out.push(cur)
      cur = ''
    } else cur += c
  }
  if (quote) throw new Error(`unclosed quote: ${cur}`)
  if (cur) out.push(cur)
  return out
}

// A token that has already taken an operator, so every comma after it is part
// of its VALUE rather than a separator.
let VALUED = new RegExp(
  `^\\.?(?:${WORD}(?:!=|~=|<=|>=|<|>|=)|(?:reaches|edges)\\[)`,
)

// The clause parts of one token. `,` between clauses is an optional separator;
// `,` inside a value is any-of, and POSITION is what tells them apart: commas
// separate until a clause takes an operator, and from there the rest of the
// token is that clause's value (`.entity,+!created` is two clauses, `.p=a,b` is
// one). A comma that touches a value's edge with a bare word on the other side
// (`.p=a, b`, `.p=a ,b`) or nothing (`.p=a,`) is neither: it is a list broken
// by a space, and is refused. With a clause on the other side (`.p=a, .q=b`,
// `trashed.at=, #Actor`) it is the optional separator it looks like.
let clauseish = (tok: string): boolean => {
  let first = splitOutside(tok.replace(/^,+/, ''), ',')[0]
  return first == '*' || /^["']/.test(first) || parseDot(first) != null
}
let parts = (tok: string, prev?: string, next?: string): string[] => {
  if (
    tok.startsWith(',') && prev && VALUED.test(prev) && !clauseish(tok)
  ) throw new Error(LIST)
  if (tok.endsWith(',') && VALUED.test(tok) && !(next && clauseish(next))) {
    throw new Error(LIST)
  }
  let out: string[] = []
  for (let p of splitOutside(tok.replace(/^,+|,+$/g, ''), ',')) {
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

// One token to its clauses. A bare word is ONE thing, a text term; the
// component it might name is the dot-marked spelling (`.entity`).
let read = (tok: string, opts: ParseOpts): Clause[] => {
  if (tok == '*') return [every()]
  if (!/^["']/.test(tok)) {
    let cs = parseDot(tok)
    if (cs) return cs
    if (opts.text === false) {
      throw new Error(
        `a query takes clauses, not words: ${tok} — quote it to search for it`,
      )
    }
  }
  return [text(stripQuotes(tok))]
}

/**
 * A query string to its AST. Whitespace and `&` both separate, every term
 * stands alone, and a value holding a space is quoted (`.title~="two words"`);
 * unquoted, `.title~=two words` is the filter `two` and the search term
 * `words`. Filters and text terms mix the way a search box does. A comma
 * between clauses is accepted and means nothing; inside a value it is any-of.
 *
 * A LONE `*` is the widest projection, not a word: it asks for every component
 * of every row selected. Only the whole token means it — a trailing `*` on a
 * word (`lemo*`) is still the full-text prefix term it always was.
 *
 * The empty query selects NOTHING: an empty string, or one with no clauses,
 * yields a lone `never`, so a blank board query does not stage the whole graph.
 */
export let parse = (q: string, opts: ParseOpts = {}): And => {
  let toks = tokens(q)
  let out: Clause[] = toks.flatMap((tok, i) =>
    parts(tok, toks[i - 1], toks[i + 1]).flatMap((p) => read(p, opts))
  )
  return { kind: 'and', clauses: out.length ? out : [{ kind: 'never' }] }
}
