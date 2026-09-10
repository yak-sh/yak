// The generic parser: a yaks query STRING to the AST. It knows the format —
// the sigils that mark a component word, the operators, the bracket a path may
// wear, list/range value forms, the reserved directives, how `&`, whitespace
// and quotes separate tokens — and nothing about any schema. Where a meaning needs
// the vocabulary (which component a bare `.status` routes to, whether a scalar
// is a time phrase or a plain word, whether `.comments` names a reverse
// association), the parser keeps the raw tokens and leaves the reading to a
// downstream compiler. See README for the full handoff.
//
// A token is one of three things BY ITS OWN SHAPE, so nothing is ever read by
// trying and failing: a component clause (it wears a sigil, or it carries an
// operator), a quoted text term, or a bare word, which is a text term. A
// malformed clause — a directive with the wrong operand, two presence filters
// mashed together, a qualifier the clause does not take — throws where it is
// read; it never falls back to text.
//
// A clause is `path [qualifiers]? operator value`. The bracket binds to the
// PATH and is read before any operator, so `.requires[<=3]->T-42` is the path
// `requires` qualified by a cap, then the walk operator; a bracket after the
// operator is part of the value.
//
// The mirror of the builders in ast.ts: `parse('.a=1 .b=2')` deep-equals
// `and(eq('a', '1'), eq('b', '2'))`.

import {
  And,
  Clause,
  Dir,
  every,
  Op,
  Qual,
  scalar,
  text,
  Value,
  WALK_DEPTH,
} from './ast.ts'

// ---- values ----

// Quotes are double or single, and a backslash inside escapes the next char.
let QUOTED = /^(["'])(.*)\1$/s
let stripQuotes = (v: string): string => {
  let m = v.match(QUOTED)
  return m ? m[2].replace(/\\(.)/gs, '$1') : v
}

// A split on `sep` that leaves quoted runs whole — and, when asked, a path's
// bracket, whose commas are its own arguments.
let splitOutside = (s: string, sep: string, brackets = false): string[] => {
  let out: string[] = []
  let cur = ''
  let quote = ''
  let bracket = false
  for (let i = 0; i < s.length; i++) {
    let c = s[i]
    if (quote) {
      cur += c
      if (c == '\\' && i + 1 < s.length) cur += s[++i]
      else if (c == quote) quote = ''
    } else if (bracket) {
      cur += c
      if (c == ']') bracket = false
    } else if (c == '"' || c == "'") {
      quote = c
      cur += c
    } else if (brackets && c == '[' && PATH.test(cur)) {
      bracket = true
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

// The shape a component clause names: dotted segments of letters, a hyphen
// only between letters — so `.requires->x` ends its word before the arrow. A
// token that is not this shape is a value or a word, never a path.
let SEG = '[A-Za-z_]+(?:-[A-Za-z_]+)*'
let WORD = `${SEG}(?:\\.${SEG})*`
// A bare path so far — where a `[` opens a bracket rather than joining a value.
let PATH = new RegExp(`^\\.?${WORD}$`)
// A prefix SIGIL and the word it marks. `.` is the neutral one and stays
// accepted before any other, so `+!created` and `+!.created` say the same thing.
// `?comp` is the prefix mirror of `!comp`: optional (selected when present,
// never filtered on) beside missing.
let SIGIL = new RegExp(`^(\\+!|[!+*#$?])\\.?(${WORD})$`)
// A component word alone, dot-marked: present. The dot is what tells `.env`
// (this entity wears `env`) from `env` (the word, searched for).
let PLAIN = new RegExp(`^\\.(${WORD})$`)
// The head of a clause: its path and the bracket it may wear.
let HEAD = new RegExp(`^\\.?(${WORD})(?:\\[([^\\]]*)\\])?`)
// The operators, longest first so `!=` is not read as `!`, `<-` not as `<`.
let OPS = /^(!=|~=|<=|>=|->|<-|<|>|=|!|\?)/

// ---- qualifiers ----

// One argument of a bracket: `<=3` (an operator and a value), `key=v`, or a
// bare `word`. Which of these a clause accepts is the clause's own business.
let QUAL = new RegExp(`^(${WORD})?(!=|<=|>=|<|>|=)(.*)$`, 's')
let qualifiers = (inside: string): Qual[] =>
  splitOutside(inside, ',').map((raw) => {
    let s = raw.trim()
    if (!s) throw new Error(`an empty qualifier: [${inside}]`)
    let m = s.match(QUAL)
    if (!m) return { value: stripQuotes(s) }
    let [, key, op, v] = m
    return { ...(key ? { key } : {}), op, value: stripQuotes(v.trim()) }
  })

// A clause that takes no qualifier says so by name — a bracket it does not read
// is never dropped, because the caller meant something by it.
let refuse = (word: string, quals: Qual[], raw: string | undefined) => {
  if (quals.length) throw new Error(`.${word} takes no qualifier: [${raw}]`)
}

// The walk's one qualifier: its depth cap, `<=N`, at least one hop. With no
// bracket this helper is not called: only explicit caps bring depth back.
let cap = (word: string, quals: Qual[]): number => {
  if (!quals.length) return WALK_DEPTH
  let [q, ...more] = quals
  if (more.length || q.key || q.op != '<=' || !/^\d+$/.test(q.value)) {
    throw new Error(`a walk takes one depth cap: .${word}[<=3]->T-42`)
  }
  let n = Number(q.value)
  if (n < 1) throw new Error(`a walk needs at least one hop: <=${q.value}`)
  return n
}

// ---- directive helpers ----

let path = (raw: string): string[] => raw.split('.')

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

// `.edges[referenced,entry.session]!` — one stored edge type, optional endpoint
// reference: two bare qualifiers, read through the same bracket as everything
// else. `.edges!` alone is the rider with nothing selected.
let edgeSelect = (quals: Qual[]): Clause => {
  let [type, via, ...more] = quals
  if (!type || more.length || quals.some((q) => q.op || q.key)) {
    throw new Error(
      '.edges selects one edge type and an optional endpoint reference: ' +
        '.edges[referenced,entry.session]!',
    )
  }
  return {
    kind: 'edges',
    peers: [],
    select: { type: type.value, ...(via ? { via: path(via.value) } : {}) },
  }
}

// One TOKEN to the clauses it contributes, or null when its shape is no clause
// at all (a bare word) — a text term to whoever called. A directive is one
// clause; an ordinary predicate is one clause too.
export let parseDot = (token: string): Clause[] | null => {
  let marked = sigil(token)
  if (marked) return marked
  // A bracket rides a path, and a sigil marks a whole word: `?doc[x]` is a
  // broken clause, never a search term.
  if (/^(\+!|[!+*#$?])\.?[A-Za-z_][^\s]*\[/.test(token)) {
    throw new Error(`not a clause: ${token}`)
  }
  // The `.` prefix is accepted everywhere and required nowhere: it keeps a URL
  // query string's filters apart from its `page` and `per`, and a rule that
  // never travels in a URL may drop it.
  let h = token.match(HEAD)
  if (!h) return null
  let [head, pathStr, bracket] = h
  let rest = token.slice(head.length)
  let dotted = token.startsWith('.')
  let quals = bracket == null ? [] : qualifiers(bracket)
  let segs = pathStr.split('.')

  if (!rest) {
    // Dot-marked, opless: presence — `.edges[cites]` being the rider's select.
    if (!dotted && bracket == null) return null
    if (pathStr == 'edges' && quals.length) return [edgeSelect(quals)]
    refuse(pathStr, quals, bracket)
    return [PRESENCE[pathStr] ?? pres(pathStr)]
  }
  let o = rest.match(OPS)
  if (!o) {
    if (!dotted && bracket == null) return null
    throw new Error(`not a clause: ${token}`)
  }
  let op: string = o[1]
  let rawValue = rest.slice(op.length)
  // `.p<-1` is less-than a negative number, not a walk to the entity `1`.
  if (op == '<-' && /^\d+(\.\d+)?$/.test(rawValue)) {
    op = '<'
    rawValue = `-${rawValue}`
  }
  let val = stripQuotes(rawValue)

  // The walk: `.requires[<=3]->T-42` selects what reaches T-42 through at most
  // three `requires`; `<-` walks the other way. One entity, by any id.
  if (op == '->' || op == '<-') {
    if (!val || val.includes(',')) {
      throw new Error(`a walk names one entity: .${pathStr}[<=3]->T-42`)
    }
    return [{
      kind: 'walk',
      path: segs,
      dir: op as Dir,
      depth: quals.length ? cap(pathStr, quals) : undefined,
      target: val,
    }]
  }
  // `.edges[referenced,entry.session]!` — the select, read above the refusal.
  if (pathStr == 'edges' && quals.length && op == '!' && !val) {
    return [edgeSelect(quals)]
  }
  // Nothing else takes a qualifier yet.
  refuse(pathStr, quals, bracket)

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

  // Two presence filters run together is a forgotten space; the mid-bang
  // reverse reading (`.comments!.author=alice`) is a schema concern (see
  // README), so at this generic layer a bang before more path is that same
  // mistake.
  if (op == '!' && val) {
    throw new Error(
      `presence filters end at !: .${pathStr}!` +
        (val.startsWith('.')
          ? ` — separate filters with a space: .${pathStr}! ${val}`
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
  return [{ kind: 'pred', path: segs, op: op as Op, value: value(val) }]
}

// ---- tokenizing a whole query ----

// The token split: whitespace and `&` both end a token; a quoted run is one
// token even across them, and so is a bracket on a path. A quote OPENS only at
// a token's start or right after an operator, so an apostrophe inside a word
// (`jeff's`) stays a letter; a bracket opens only after a bare path, so one
// inside a value is a character of the value. An unclosed quote or bracket is
// refused: the rest of the line was not what the caller meant.
let tokens = (q: string): string[] => {
  let out: string[] = []
  let cur = ''
  let quote = ''
  let bracket = false
  for (let i = 0; i < q.length; i++) {
    let c = q[i]
    if (quote) {
      cur += c
      if (c == '\\' && i + 1 < q.length) cur += q[++i]
      else if (c == quote) quote = ''
    } else if (bracket) {
      cur += c
      if (c == ']') bracket = false
    } else if ((c == '"' || c == "'") && /^$|[=<>,]$/.test(cur)) {
      quote = c
      cur += c
    } else if (c == '[' && PATH.test(cur)) {
      bracket = true
      cur += c
    } else if (c == '&' || /\s/.test(c)) {
      if (cur) out.push(cur)
      cur = ''
    } else cur += c
  }
  if (quote) throw new Error(`unclosed quote: ${cur}`)
  if (bracket) throw new Error(`unclosed bracket: ${cur}`)
  if (cur) out.push(cur)
  return out
}

/** What a parse may say about the query it is reading. */
export type ParseOpts = {
  /** whether a bare word is a full-text term (default true). A rule, or a saved
   * filter that must not quietly change meaning, passes `false`: a stray word
   * is then refused rather than becoming a search term nobody asked for. */
  text?: boolean
}

// A token that has already taken an operator, so every comma after it is part
// of its VALUE rather than a separator.
let VALUED = new RegExp(
  `^\\.?${WORD}(?:\\[[^\\]]*\\])?(?:!=|~=|<=|>=|->|<-|<|>|=)`,
)

// The clause parts of one token. `,` between clauses is an optional separator;
// `,` inside a value is any-of, and POSITION is what tells them apart: commas
// separate until a clause takes an operator, and from there the rest of the
// token is that clause's value (`.entity,+!created` is two clauses, `.p=a,b` is
// one). A comma inside a path's bracket is the bracket's own. A comma that
// touches a value's edge with a bare word on the other side (`.p=a, b`,
// `.p=a ,b`) or nothing (`.p=a,`) is neither: it is a list broken by a space,
// and is refused. With a clause on the other side (`.p=a, .q=b`,
// `trashed.at=, #Actor`) it is the optional separator it looks like.
let clauseish = (tok: string): boolean => {
  let first = splitOutside(tok.replace(/^,+/, ''), ',', true)[0]
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
  for (let p of splitOutside(tok.replace(/^,+|,+$/g, ''), ',', true)) {
    if (out.length && VALUED.test(out[out.length - 1])) {
      out[out.length - 1] += ',' + p
    } else out.push(p)
  }
  return out.filter(Boolean)
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
