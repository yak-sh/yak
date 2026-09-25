// The parser: a yaks query string to the AST. It knows the format — the prefix
// characters on a component name, the operators, the bracket a path may carry,
// the list and range forms of a value, the reserved directives, and how `&`,
// whitespace and quotes separate tokens — and nothing about any schema. Where a
// meaning needs the vocabulary (which component a bare `.status` belongs to,
// whether a scalar is a time phrase or a plain word, whether `.comments` names
// a reverse association), the parser keeps the raw tokens and leaves the
// reading to a compiler that has a schema. See README for the full division.
//
// A token is one of three things by how it is written, so nothing is ever
// parsed by trying one reading and falling back to another: a clause on a
// component (it starts with a prefix character, or it contains an operator), a
// quoted text term, or a bare word, which is a text term. A malformed clause —
// a directive with the wrong operand, two presence filters run together, a
// qualifier the clause does not take — throws where it is read; it never falls
// back to text. It throws a `SyntaxError`, which is the caller's to fix: a door
// answers it 400 (@yaks/api) rather than taking it for its own fault.
//
// A clause is `path [qualifiers]? operator value`. The bracket binds to the
// PATH and is read before any operator, so `.requires[<=3]->T-42` is the path
// `requires` with a depth cap, then the walk operator; a bracket after the
// operator is part of the value.
//
// The mirror of the builders in ast.ts: `parse('.a=1 .b=2')` deep-equals
// `and(eq('a', '1'), eq('b', '2'))`.

import {
  And,
  and,
  Clause,
  Dir,
  every,
  Op,
  or,
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

// A split on `sep` that leaves quoted runs whole — and, when asked, leaves a
// path's bracket whole too, since its commas separate its own arguments.
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

// One atom: a range (`x..y`, or `x...y` for an exclusive end) or a scalar.
// Recognizing a range needs no type, because the current matcher applies `..`
// to every property.
let atom = (raw: string): Value => {
  let m = raw.match(/^(.*?)\.\.(\.?)(.*)$/s)
  if (!m) return scalar(raw)
  let [, lo, excl, hi] = m
  return { kind: 'range', lo: scalar(lo), hi: scalar(hi), exclusiveEnd: !!excl }
}

// A whole value: a comma-separated list means any-of; a single part is its
// atom. A member is never empty — `open,,wip` and a trailing comma are refused
// rather than repaired — and a member containing a space was quoted, so the
// quotes come off here.
let value = (raw: string): Value => {
  let items = splitOutside(raw, ',')
  if (items.length == 1) return atom(raw)
  if (items.some((s) => !s)) throw new SyntaxError(LIST)
  return { kind: 'list', items: items.map((s) => atom(stripQuotes(s))) }
}

// ---- component names ----

// The shape of a path in a component clause: dotted segments of letters, with a
// hyphen only between letters — so `.requires->x` ends its path before the
// arrow. A token not of this shape is a value or a text term, never a path.
let SEG = '[A-Za-z_]+(?:-[A-Za-z_]+)*'
let WORD = `${SEG}(?:\\.${SEG})*`
// A bare path so far — where a `[` opens a bracket rather than joining a value.
let PATH = new RegExp(`^\\.?${WORD}$`)
// A prefix character and the component name it marks, with nothing between
// them: `!created`, never `!.created`. `?comp` is the prefix mirror of `!comp`:
// optional (selected when present, never filtered on) against absent. `-comp`
// is the opposite of `+comp`: `+` means a component is added, `-` means one was
// removed — which is why a leading minus marks a component name here, and a
// bare `-word` is no longer a text term.
let SIGIL = new RegExp(`^(\\+!|[-!+*#$?])(${WORD})$`)
// A prefix with a dot after it: the one spelling it had beside the one it has.
let DOTTED = /^(\+!|[-!+*#$?])\.([A-Za-z_].*)$/s
// A component name alone, with the leading dot: present. The dot is what tells
// `.env` (this entity has the component `env`) from `env` (a word to search
// for).
let PLAIN = new RegExp(`^\\.(${WORD})$`)
// The head of a clause: its path and the bracket it may carry.
let HEAD = new RegExp(`^\\.?(${WORD})(?:\\[([^\\]]*)\\])?`)
// The operators, longest first so `<=` is not read as `<`, `<-` not as `<`.
let OPS = /^(!=|~=|<=|>=|->|<-|<|>|=)/

// A clause in a spelling it had before each had one (T-39341), refused by the
// one it has: presence was `.p!` (and `.p!=` with no value), absence `.p=`
// with no value, the request `.p?`, and a prefix could take a dot, `!.p`.
let spelled = (token: string, one: string) =>
  new SyntaxError(`${token} is written ${one}`)

// ---- qualifiers ----

// One argument of a bracket: `<=3` (an operator and a value), `key=v`, or a
// bare word. Which of these it accepts is up to the clause.
let QUAL = new RegExp(`^(${WORD})?(!=|<=|>=|<|>|=)(.*)$`, 's')
let qualifiers = (inside: string): Qual[] =>
  splitOutside(inside, ',').map((raw) => {
    let s = raw.trim()
    if (!s) throw new SyntaxError(`an empty qualifier: [${inside}]`)
    let m = s.match(QUAL)
    if (!m) return { value: stripQuotes(s) }
    let [, key, op, v] = m
    return { ...(key ? { key } : {}), op, value: stripQuotes(v.trim()) }
  })

// A clause that takes no qualifier refuses one by name — a bracket it does not
// read is never dropped, because the caller meant something by it.
let refuse = (word: string, quals: Qual[], raw: string | undefined) => {
  if (quals.length) {
    throw new SyntaxError(`.${word} takes no qualifier: [${raw}]`)
  }
}

// The walk's one qualifier: its depth cap, `<=N`, of at least one hop. With no
// bracket this helper is not called: only an explicit cap sets a depth.
let cap = (word: string, quals: Qual[]): number => {
  if (!quals.length) return WALK_DEPTH
  let [q, ...more] = quals
  if (more.length || q.key || q.op != '<=' || !/^\d+$/.test(q.value)) {
    throw new SyntaxError(`a walk takes one depth cap: .${word}[<=3]->T-42`)
  }
  let n = Number(q.value)
  if (n < 1) {
    throw new SyntaxError(`a walk needs at least one hop: <=${q.value}`)
  }
  return n
}

// ---- directive helpers ----

let path = (raw: string): string[] => raw.split('.')

// The reserved names whose whole meaning is presence: `.count` counts, `.edges`
// carries edges back, `.refs` references anything.
let PRESENCE: Record<string, Clause> = {
  count: { kind: 'count' },
  edges: { kind: 'edges', peers: [] },
  refs: { kind: 'refs', op: '!', value: '' },
}
// And the one whose absence means something of its own: `!refs` references
// nothing.
let ABSENCE: Record<string, Clause> = {
  refs: { kind: 'refs', op: '=', value: '' },
}

// The entity a cursor names, read from its number or its human id (the same
// number with a display prefix); `undefined` for anything else, so a caller
// refuses a cursor it cannot read rather than silently restarting from the
// front. `.after=` and an HTTP endpoint's own `after=` parameter are read by
// this one function.
export let cursor = (val: string): number | undefined => {
  let m = val.match(/^(?:[A-Za-z]+-)?(\d+)$/)
  return m ? Number(m[1]) : undefined
}

// A component name with a prefix character, or null when the token has none.
// `!comp` and `.comp` are ordinary predicates — absence and presence are
// questions any evaluator answers from stored data — and the rest mean
// something only a write or a rule engine can act on. `-comp` is the newest of
// them: absence is a question about a row, a removal is a question about the
// write that took it away, and no amount of reading the stored rows tells them
// apart.
let sigil = (token: string): Clause[] | null => {
  let dot = token.match(DOTTED)
  if (dot) throw spelled(token, dot[1] + dot[2])
  // An eid fragment is a singleton resource too; unlike a component name it
  // may contain (or consist entirely of) digits. The store resolves it.
  if (/^#[0-9a-f]{6,64}$/i.test(token)) {
    return [{ kind: 'resource', comp: token.slice(1) }]
  }
  let plain = token.match(PLAIN)
  if (plain) return [PRESENCE[plain[1]] ?? pres(plain[1])]
  let m = token.match(SIGIL)
  if (!m) return null
  let [, mark, word] = m
  if (mark == '!') {
    return [
      ABSENCE[word] ??
        { kind: 'pred', path: path(word), op: '=', value: scalar('') },
    ]
  }
  if (mark == '?') {
    return [{ kind: 'pred', path: path(word), op: '?', value: null }]
  }
  if (mark == '+') return [{ kind: 'ensure', comp: word }]
  if (mark == '+!') return [{ kind: 'gate', comp: word }]
  if (mark == '*') return [{ kind: 'mutable', comp: word }]
  if (mark == '#') return [{ kind: 'resource', comp: word }]
  if (mark == '-') return [{ kind: 'gone', comp: word }]
  return [{ kind: 'var', name: word }]
}

let pres = (word: string): Clause => ({
  kind: 'pred',
  path: path(word),
  op: '!',
  value: null,
})

// `.edges[referenced,entry.session]` — one stored edge type and an optional
// endpoint reference: two bare qualifiers, read through the same bracket as
// everything else. `.edges` alone carries edges back with nothing selected.
let edgeSelect = (quals: Qual[]): Clause => {
  let [type, via, ...more] = quals
  if (!type || more.length || quals.some((q) => q.op || q.key)) {
    throw new SyntaxError(
      '.edges selects one edge type and an optional endpoint reference: ' +
        '.edges[referenced,entry.session]',
    )
  }
  return {
    kind: 'edges',
    peers: [],
    select: { type: type.value, ...(via ? { via: path(via.value) } : {}) },
  }
}

// One token to the clauses it contributes, or null when it is not a clause at
// all (a bare word) — which the caller reads as a text term. A directive is one
// clause; an ordinary predicate is one clause too.
export let parseDot = (token: string): Clause[] | null => {
  // A `!` before a child path negates the reverse existential, not its leaf.
  // Whether the leading name is an association is still for the binder to say.
  let reverse = token.match(/^\.?([A-Za-z_]+(?:\.[A-Za-z_]+)*)!\.(.+)$/s)
  if (reverse) {
    let inner = parseDot(`.${reverse[2]}`)
    if (inner?.length == 1 && inner[0].kind == 'pred') {
      let names = reverse[1].split('.')
      let child = inner[0]
      let c: Clause = child.not || child.where
        ? {
          kind: 'pred',
          path: [names.pop()!],
          op: '!',
          value: null,
          where: child,
          not: true,
        }
        : { ...child, path: [names.pop()!, ...child.path], not: true }
      for (let name of names.reverse()) {
        c = { kind: 'pred', path: [name], op: '!', value: null, where: c }
      }
      return [c]
    }
    throw new SyntaxError(`a reverse filter needs a child predicate: ${token}`)
  }
  let marked = sigil(token)
  if (marked) return marked
  // `$x=5` — a variable and the value bound to it. A query consisting of
  // nothing but these is a set of bindings, which is what the arguments to a
  // template invocation are (`+foo.bar=$x` merged with `$x=5`).
  let bound = token.match(new RegExp(`^\\$(${SEG})=(.*)$`, 's'))
  if (bound) {
    return [{ kind: 'var', name: bound[1], value: value(bound[2]) }]
  }
  // A prefix character marks a whole component name (`+doc`), and it marks a
  // PATH carrying an operator just the same (`+doc.title=$x`): the prefix means
  // the component is written, and the property beside it names which part of
  // it. The gate is left out — an absence has no value to write.
  let written = token.match(/^([+*])([A-Za-z_].*)$/s)
  if (written) {
    let [, mark, rest] = written
    let inner = parseDot(`.${rest}`)
    let c = inner?.length == 1 ? inner[0] : undefined
    if (!c || c.kind != 'pred' || c.op != '=' || !c.value) {
      throw new SyntaxError(
        `a written word takes a value: ${mark}doc.title=Dune`,
      )
    }
    if (c.path.length != 2) {
      throw new SyntaxError(
        `a written word names a component and a property: ${token}`,
      )
    }
    let [comp, prop] = c.path
    return [
      mark == '+'
        ? { kind: 'ensure', comp, prop, value: c.value }
        : { kind: 'mutable', comp, prop, value: c.value },
    ]
  }
  // A bracket belongs to a path, and a prefix character marks a whole component
  // name: `?doc[x]` is a broken clause, never a search term.
  if (/^(\+!|[!+*#$?])[A-Za-z_][^\s]*\[/.test(token)) {
    throw new SyntaxError(`not a clause: ${token}`)
  }
  // The `.` prefix is accepted everywhere and required nowhere: it keeps a URL
  // query string's filters apart from its `page` and `per` parameters, and a
  // rule that never appears in a URL can leave it off.
  let h = token.match(HEAD)
  if (!h) return null
  let [head, pathStr, bracket] = h
  let rest = token.slice(head.length)
  let dotted = token.startsWith('.')
  let quals = bracket == null ? [] : qualifiers(bracket)
  let segs = pathStr.split('.')

  if (!rest) {
    // A leading dot and no operator: presence — `.edges[cites]` selecting one
    // edge type is the exception.
    if (!dotted && bracket == null) return null
    if (pathStr == 'edges' && quals.length) return [edgeSelect(quals)]
    refuse(pathStr, quals, bracket)
    return [PRESENCE[pathStr] ?? pres(pathStr)]
  }
  if (rest == '!') {
    throw spelled(token, `.${pathStr}${bracket == null ? '' : `[${bracket}]`}`)
  }
  if (rest == '?') throw spelled(token, `?${pathStr}`)
  let o = rest.match(OPS)
  if (!o) {
    if (!dotted && bracket == null) return null
    throw new SyntaxError(`not a clause: ${token}`)
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
      throw new SyntaxError(`a walk names one entity: .${pathStr}[<=3]->T-42`)
    }
    return [{
      kind: 'walk',
      path: segs,
      dir: op as Dir,
      depth: quals.length ? cap(pathStr, quals) : undefined,
      target: val,
    }]
  }
  // Nothing else takes a qualifier yet.
  refuse(pathStr, quals, bracket)

  // Rankings and the reverse-union: a value or presence, never a filter.
  if (pathStr == 'order' && op == '=') return [{ kind: 'order', value: val }]
  if (pathStr == 'near' && op == '=') return [{ kind: 'near', value: val }]
  if (pathStr == 'refs') {
    if (op == '=' && !rawValue) throw spelled(token, '!refs')
    if (op == '=') return [{ kind: 'refs', op: '=', value: val }]
    throw new SyntaxError(
      '.refs takes an id (.refs=T-3), presence (.refs) or absence (!refs)',
    )
  }
  // `.distinct=prop` / `.tally=prop` — an aggregate over one property. The
  // property stays raw segments; whether it is a single property or an invalid
  // path is schema.
  if (pathStr == 'distinct' || pathStr == 'tally') {
    if (op != '=' || !val) {
      throw new SyntaxError(`.${pathStr} names a property: .${pathStr}=domain`)
    }
    return [{ kind: pathStr, path: path(val) }]
  }
  // `.fields=pin.x,pin.z~` — the projection; a trailing `~` keeps a property
  // from waking a subscription. Each property stays raw segments.
  if (pathStr == 'fields') {
    if (op != '=' || !val) {
      throw new SyntaxError('.fields names properties: .fields=pin.x,pin.y')
    }
    let fields = val.split(',').map((seg) => {
      let wake = !seg.endsWith('~')
      return { path: path(wake ? seg : seg.slice(0, -1)), wake }
    })
    return [{ kind: 'fields', fields }]
  }
  // `.limit=200` — how many rows at most. A bound that was guessed is worse
  // than none, so a non-integer is refused rather than dropped.
  if (pathStr == 'limit') {
    if (op != '=' || !/^\d+$/.test(val)) {
      throw new SyntaxError('.limit takes a whole number: .limit=200')
    }
    return [{ kind: 'limit', n: Number(val) }]
  }
  // `.after=13882` / `.after=T-13882` — the paging cursor. It names an entity
  // by its spine number, never a position or an order key: an evaluator works
  // out where that entity sits in whatever order the query asked for, so this
  // one form pages every ordering. A human id is that same number with a
  // display prefix, so it is read here without consulting the store: inputs
  // accept human ids.
  if (pathStr == 'after') {
    let n = op == '=' ? cursor(val) : undefined
    if (n == null) {
      throw new SyntaxError('.after takes an entity number or id: .after=T-200')
    }
    return [{ kind: 'after', n }]
  }
  // `.edges.limit=200` / `.edges.peers=status,title` — how the edges `.edges`
  // carries back are cut and projected.
  if (segs[0] == 'edges') {
    if (segs.length == 2 && segs[1] == 'limit' && op == '=') {
      if (!/^\d+$/.test(val)) {
        throw new SyntaxError(
          '.edges.limit takes a whole number: .edges.limit=200',
        )
      }
      return [{ kind: 'edges', peers: [], limit: Number(val) }]
    }
    if (segs.length == 2 && segs[1] == 'peers' && op == '=' && val) {
      return [{ kind: 'edges', peers: val.split(',').map(path) }]
    }
    throw new SyntaxError(
      '.edges rides a query (.edges) and may project the far endpoint ' +
        '(.edges.peers=status,title)',
    )
  }

  if (!rawValue && op == '=') throw spelled(token, `!${pathStr}`)
  if (!rawValue && op == '!=') throw spelled(token, `.${pathStr}`)

  // An ordinary predicate. Contains (`~=`) is deliberately literal, so its
  // value is one raw scalar; every other form parses list and range structure.
  if (op == '~=') return [{ kind: 'pred', path: segs, op, value: scalar(val) }]
  return [{ kind: 'pred', path: segs, op: op as Op, value: value(val) }]
}

// ---- tokenizing a whole query ----

// The token split: whitespace and `&` both end a token; a quoted run is one
// token even across them, and so is a bracket on a path. A quote opens only at
// a token's start or immediately after an operator, so an apostrophe inside a
// word (`jeff's`) stays a letter; a bracket opens only after a bare path, so
// one inside a value is just a character of the value. An unclosed quote or
// bracket is refused: the rest of the query was not what the caller meant.
// A `(` opening a token starts a group: everything to its matching `)` is one
// token, parsed on its own (parse below), so `|` and `&` inside it bind there.
// A `|` outside quotes, brackets and groups is its own token, the OR separator.
let tokens = (q: string): string[] => {
  let out: string[] = []
  let cur = ''
  let quote = ''
  let bracket = false
  let depth = 0
  for (let i = 0; i < q.length; i++) {
    let c = q[i]
    if (quote) {
      cur += c
      if (c == '\\' && i + 1 < q.length) cur += q[++i]
      else if (c == quote) quote = ''
    } else if (depth) {
      if ((c == '"' || c == "'") && /[=<>,(\s&|]$/.test(cur)) quote = c
      else if (c == '(') depth++
      else if (c == ')') depth--
      cur += c
    } else if (bracket) {
      cur += c
      if (c == ']') bracket = false
    } else if ((c == '"' || c == "'") && /^$|[=<>,]$/.test(cur)) {
      quote = c
      cur += c
    } else if (c == '(' && !cur) {
      depth = 1
      cur = c
    } else if (c == '[' && PATH.test(cur)) {
      bracket = true
      cur += c
    } else if (c == '|') {
      if (cur) out.push(cur)
      out.push('|')
      cur = ''
    } else if (c == '&' || /\s/.test(c)) {
      if (cur) out.push(cur)
      cur = ''
    } else cur += c
  }
  if (quote) throw new SyntaxError(`unclosed quote: ${cur}`)
  if (bracket) throw new SyntaxError(`unclosed bracket: ${cur}`)
  if (depth) throw new SyntaxError(`unclosed group: ${cur}`)
  if (cur) out.push(cur)
  return out
}

/** How `parse` should read the query it is given. */
export type ParseOpts = {
  /** whether a bare word is a full-text term (default true). A rule, or a saved
   * filter that must not quietly change meaning, passes `false`: a stray word
   * is then refused rather than becoming a search term nobody asked for. */
  text?: boolean
}

// A token that has already taken an operator, so every comma after it is part
// of its value rather than a separator.
let VALUED = new RegExp(
  `^\\.?${WORD}(?:\\[[^\\]]*\\])?(?:!=|~=|<=|>=|->|<-|<|>|=)`,
)

// The clause parts of one token. A `,` between clauses is an optional
// separator; a `,` inside a value means any-of, and position is what tells them
// apart: commas separate until a clause takes an operator, and from there the
// rest of the token is that clause's value (`.entity,+!created` is two clauses,
// `.p=a,b` is one). A comma inside a path's bracket belongs to the bracket. A
// comma at the edge of a value with a bare word on the other side (`.p=a, b`,
// `.p=a ,b`) or nothing (`.p=a,`) is neither: it is a list broken by a space,
// and is refused. With a clause on the other side (`.p=a, .q=b`,
// `.p=a, #Actor`) it is the optional separator it looks like.
let clauseish = (tok: string): boolean => {
  let first = splitOutside(tok.replace(/^,+/, ''), ',', true)[0]
  return first == '*' || /^["']/.test(first) || parseDot(first) != null
}
let parts = (tok: string, prev?: string, next?: string): string[] => {
  // A group is one term; its commas belong to the clauses inside it.
  if (tok.startsWith('(')) return [tok]
  if (
    tok.startsWith(',') && prev && VALUED.test(prev) && !clauseish(tok)
  ) throw new SyntaxError(LIST)
  if (tok.endsWith(',') && VALUED.test(tok) && !(next && clauseish(next))) {
    throw new SyntaxError(LIST)
  }
  let out: string[] = []
  for (let p of splitOutside(tok.replace(/^,+|,+$/g, ''), ',', true)) {
    if (out.length && VALUED.test(out[out.length - 1])) {
      out[out.length - 1] += ',' + p
    } else out.push(p)
  }
  return out.filter(Boolean)
}

// One token to its clauses. A bare word is only ever a text term; to name the
// component instead, write the leading dot (`.entity`).
let read = (tok: string, opts: ParseOpts): Clause[] => {
  if (tok == '*') return [every()]
  if (tok.startsWith('(')) return parse(tok.slice(1, -1), opts).clauses
  if (!/^["']/.test(tok)) {
    let cs = parseDot(tok)
    if (cs) return cs
    if (opts.text === false) {
      throw new SyntaxError(
        `a query takes clauses, not words: ${tok} — quote it to search for it`,
      )
    }
  }
  return [text(stripQuotes(tok))]
}

let clauses = (toks: string[], opts: ParseOpts): Clause[] =>
  toks.flatMap((tok, i) =>
    parts(tok, toks[i - 1], toks[i + 1]).flatMap((p) => read(p, opts))
  )

/**
 * A query string to its AST. Whitespace and `&` both separate terms, every term
 * stands on its own, and a value containing a space is quoted
 * (`.title~="two words"`); unquoted, `.title~=two words` is the filter `two`
 * plus the search term `words`. Filters and text terms mix the way they do in a
 * search box. A comma between clauses is accepted and means nothing; inside a
 * value it means any-of.
 *
 * A `*` on its own is the widest projection, not a term: it asks for every
 * component of every row selected. Only the whole token means that — a trailing
 * `*` on a word (`lemo*`) is still the full-text prefix term it has always
 * been.
 *
 * The empty query selects nothing: an empty string, or one with no clauses,
 * returns a single `never`, so a blank saved query does not load the whole
 * graph.
 */
export let parse = (q: string, opts: ParseOpts = {}): And => {
  // `|` is OR and binds looser than the AND of adjacent terms: `.a=1 .b=2|.c=3`
  // is (a and b) or c. A parenthesised group is one term, so `.a=1 (.b=2|.c=3)`
  // is a and (b or c). An empty alternative is refused rather than read as
  // "nothing", which would quietly select nothing.
  let alts: string[][] = [[]]
  for (let tok of tokens(q)) {
    if (tok == '|') alts.push([])
    else alts[alts.length - 1].push(tok)
  }
  let groups = alts.map((toks) => clauses(toks, opts))
  if (groups.length > 1 && groups.some((g) => !g.length)) {
    throw new SyntaxError(`an empty alternative beside |: ${q}`)
  }
  let out = groups.length == 1
    ? groups[0]
    : [or(...groups.map((g) => g.length == 1 ? g[0] : and(...g)))]
  return { kind: 'and', clauses: out.length ? out : [{ kind: 'never' }] }
}
