// What a REPL cell declares at its top level, read from its JavaScript: the
// names its `let`, `const` and `var` bind, and the source of each `function`
// and `class` it declares. A cell's wrapper keeps those names' values, and
// the next cell declares them again (./repl.ts). Nothing here evaluates code.
//
// It reads tokens, not a syntax tree: strings, templates, comments and
// regular expressions are skipped, and only what stands at the body's own
// depth counts. A name it reads that the cell never bound costs nothing (the
// wrapper's read of it fails and is skipped); a name it misses is not kept.

export type Declared = {
  /** names bound by `let`, `const` and `var` */
  names: string[]
  /** each `function` and `class` declaration's source, by its name */
  declarations: Record<string, string>
}

type Token = {
  text: string
  start: number
  end: number
  /** a newline came before it */
  line: boolean
  /** the bracket depth it stands at, from 0 */
  depth: number
}

let IDENT_START = /^[A-Za-z_$\u0080-\uffff]/
let IDENT = /[A-Za-z_$\u0080-\uffff][\w$\u0080-\uffff]*/y
let NUMBER = /\d[\w.]*|\.\d[\w]*/y
let PUNCT =
  />>>=|\.\.\.|===|!==|\*\*=|<<=|>>=|>>>|&&=|\|\|=|\?\?=|=>|==|!=|<=|>=|&&|\|\||\?\?|\?\.|\+\+|--|\+=|-=|\*=|\/=|%=|&=|\|=|\^=|\*\*|<<|>>|[{}()[\];,<>+\-*/%&|^!~?:=.@#]/y
// After these, `/` starts a regular expression rather than dividing.
let BEFORE_REGEX = new Set([
  'return',
  'typeof',
  'instanceof',
  'in',
  'of',
  'new',
  'delete',
  'void',
  'throw',
  'case',
  'do',
  'else',
  'yield',
  'await',
])
// Whether a token ends an expression: a name, a literal (a string, a number,
// a regular expression, a template's last part) or a closing bracket.
let ends = (t?: Token) =>
  !!t && (IDENT_START.test(t.text) && !BEFORE_REGEX.has(t.text) ||
    /^['"`\d]/.test(t.text) || t.text.length > 2 && t.text[0] == '/' ||
    t.text[0] == '}' && t.text.at(-1) == '`' ||
    t.text == ')' || t.text == ']' || t.text == '}')

/** The tokens of JavaScript source, with the depth each stands at. */
export let tokens = (src: string): Token[] => {
  let out: Token[] = []
  let depth = 0
  // What each open bracket was, and for `${`, that a template resumes.
  let open: string[] = []
  let line = false
  let i = 0
  let push = (start: number, end: number, at = depth) => {
    out.push({ text: src.slice(start, end), start, end, line, depth: at })
    line = false
  }
  // The rest of a template from `i`, to its end or its next `${`.
  let template = () => {
    let start = i
    while (i < src.length) {
      let c = src[i]
      if (c == '\\') i += 2
      else if (c == '`') {
        i++
        push(start, i)
        return
      } else if (c == '$' && src[i + 1] == '{') {
        i += 2
        push(start, i)
        open.push('${')
        depth++
        return
      } else i++
    }
    push(start, i)
  }
  while (i < src.length) {
    let c = src[i]
    if (c == '\n') {
      line = true
      i++
    } else if (/\s/.test(c)) i++
    else if (c == '/' && src[i + 1] == '/') {
      while (i < src.length && src[i] != '\n') i++
    } else if (c == '/' && src[i + 1] == '*') {
      let end = src.indexOf('*/', i + 2)
      let skipped = src.slice(i, end < 0 ? src.length : end)
      if (skipped.includes('\n')) line = true
      i = end < 0 ? src.length : end + 2
    } else if (c == '"' || c == "'") {
      let start = i++
      while (i < src.length && src[i] != c && src[i] != '\n') {
        i += src[i] == '\\' ? 2 : 1
      }
      i++
      push(start, i)
    } else if (c == '`') {
      i++
      template()
    } else if (c == '/' && !ends(out.at(-1))) {
      let start = i++
      let klass = false
      while (i < src.length && src[i] != '\n') {
        if (src[i] == '\\') i++
        else if (src[i] == '[') klass = true
        else if (src[i] == ']') klass = false
        else if (src[i] == '/' && !klass) break
        i++
      }
      i++
      while (/[a-z]/.test(src[i] ?? '')) i++
      push(start, i)
    } else {
      let match = (re: RegExp) => {
        re.lastIndex = i
        return re.exec(src)?.[0]
      }
      let word = match(IDENT) ?? match(NUMBER) ?? match(PUNCT) ?? c
      let start = i
      i += word.length
      if (word == '{' || word == '(' || word == '[') {
        push(start, i)
        open.push(word)
        depth++
      } else if (word == '}' || word == ')' || word == ']') {
        let was = open.pop()
        depth = Math.max(0, depth - 1)
        if (was == '${') template()
        else push(start, i)
      } else push(start, i)
    }
  }
  return out
}

/** What a cell's body declares at its own top level. */
export let declared = (body: string): Declared => {
  let ts = tokens(body)
  let names = new Set<string>()
  let declarations: Record<string, string> = {}
  let at = (n: number) => ts[n]?.text
  // Whether the token at n starts a statement of the body.
  let starts = (n: number) => {
    let before = ts[n - 1]
    return !before || before.text == ';' || before.text == '}' ||
      ts[n].line && ends(before)
  }
  // The names a binding pattern from n binds, and where it ends.
  let pattern = (n: number): number => {
    let t = ts[n]
    if (!t) return n
    if (IDENT_START.test(t.text)) {
      names.add(t.text)
      return n + 1
    }
    if (t.text != '{' && t.text != '[') return n
    let base = t.depth
    let i = n + 1
    while (ts[i] && !(ts[i].depth == base && /^[}\]]$/.test(ts[i].text))) {
      let text = ts[i].text
      if (text == '=') {
        // A default value: skipped to the next element of this pattern.
        let level = ts[i].depth
        i++
        while (
          ts[i] && !(ts[i].depth == level && ts[i].text == ',') &&
          ts[i].depth >= level &&
          !(ts[i].depth == level - 1)
        ) i++
        continue
      }
      if (
        IDENT_START.test(text) &&
        /^[,}\]=]$/.test(at(i + 1) ?? '') && at(i - 1) != '.'
      ) names.add(text)
      i++
    }
    return i + 1
  }
  // The end of a declaration's initializer at depth 0: a comma for the next
  // declarator, a semicolon, or a new statement on a new line.
  let initialized = (n: number): { next: number; more: boolean } => {
    let i = n
    while (ts[i]) {
      let t = ts[i]
      if (t.depth == 0 && t.text == ',') return { next: i + 1, more: true }
      if (t.depth == 0 && t.text == ';') return { next: i + 1, more: false }
      if (
        i > n && t.depth == 0 && t.line && ends(ts[i - 1]) &&
        IDENT_START.test(t.text)
      ) return { next: i, more: false }
      i++
    }
    return { next: i, more: false }
  }
  // The source of a declaration from n: through the brace closing its body.
  let whole = (n: number) => {
    let i = n
    let entered = false
    while (ts[i]) {
      if (ts[i].depth == 0 && ts[i].text == '{') entered = true
      if (entered && ts[i].depth == 0 && ts[i].text == '}') break
      i++
    }
    return { source: body.slice(ts[n].start, ts[i]?.end), next: i + 1 }
  }
  let i = 0
  while (i < ts.length) {
    let t = ts[i]
    if (t.depth != 0 || !starts(i)) {
      i++
      continue
    }
    if (/^(let|const|var)$/.test(t.text) && /^[\w${[]/.test(at(i + 1) ?? '')) {
      let n = i + 1
      while (true) {
        n = pattern(n)
        let { next, more } = at(n) == '=' ? initialized(n + 1) : {
          next: at(n) == ',' ? n + 1 : at(n) == ';' ? n + 1 : n,
          more: at(n) == ',',
        }
        n = next
        if (!more) break
      }
      i = Math.max(n, i + 1)
      continue
    }
    let fn = t.text == 'async' && at(i + 1) == 'function' ? i + 1 : i
    if (at(fn) == 'function' || t.text == 'class') {
      let named = at(fn + 1) == '*' ? fn + 2 : fn + 1
      let name = at(named)
      if (name && IDENT_START.test(name)) {
        let { source, next } = whole(i)
        declarations[name] = source
        names.delete(name)
        i = next
        continue
      }
    }
    i++
  }
  for (let name of Object.keys(declarations)) names.delete(name)
  return { names: [...names], declarations }
}
