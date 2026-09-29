// The examples written beside the code, run as tests. Two forms:
//
// - a doctest line in a module: `/// input -> output` (equality),
//   `/// input ~> pattern` (a partial match, awaited), `/// input throws
//   'message'`, or a statement (`/// let n = 1`) the file's doctests share.
//   `// /` skips a line, and a line indented past the first continues it;
// - a fenced ```ts block in a Markdown page or a module's doc comment. A
//   block marked `ignore` is skipped.
//
// An example in a module sees that module's exports unimported, as
// `deno test --doc` gave them. Each fenced example compiles to a module of
// its own, and a page's doctests to one; each is written beside its page, so
// its imports resolve exactly as the page's do, and is gone once loaded. Its
// code keeps the page's line numbers, so a failure points at the page's line.

/** One doctest: its first line, its kind, and its code, or its two sides. */
export type Doctest = {
  line: number
  skip: boolean
  op?: '->' | '~>' | 'throws'
  code: string
}

/** One fenced example: the line its fence opens on, and its code. */
export type Fence = { line: number; skip: boolean; lang: string; code: string }

let DOCTEST = /^\s*\/\/( ?)\/ (.*)$/

/// doctests('/// f(1) -> 2')[0] ~> { line: 1, op: '->', code: 'f(1) -> 2' }
/// doctests('/// <reference lib="deno.ns" />') -> []
/// doctests('// / later() -> 2')[0].skip -> true
/**
 * The doctests in a module's source, a line indented past its first joined
 * to it.
 */
export let doctests = (source: string): Doctest[] => {
  let out: (Doctest & { end: number })[] = []
  for (let [i, text] of source.split('\n').entries()) {
    let [, skip, code] = text.match(DOCTEST) ?? []
    if (code === undefined || code.startsWith('<')) continue
    let last = out.at(-1)
    if (/^\s/.test(code) && last?.end == i - 1) {
      last.code += `\n${code}`
      last.end = i
    } else out.push({ line: i + 1, end: i, skip: !!skip, code })
  }
  return out.map(({ line, skip, code }) => ({
    line,
    skip,
    code,
    op: split(code)?.op,
  }))
}

/// split("f('a -> b') -> 'c -> d'") -> { actual: "f('a -> b')", op: '->', expected: "'c -> d'" }
/// split('g([1,\n  2])\n  -> 3') -> { actual: 'g([1,\n  2])', op: '->', expected: '3' }
/// split('let n = 1') -> undefined
/** A doctest's two sides: the first operator outside a string or bracket. */
export let split = (
  code: string,
): { actual: string; op: Doctest['op']; expected: string } | undefined => {
  let depth = 0, quote = ''
  for (let i = 0; i < code.length; i++) {
    let c = code[i]
    if (quote) {
      if (c == '\\') i++
      else if (c == quote) quote = ''
    } else if (`'"\``.includes(c)) quote = c
    else if ('([{'.includes(c)) depth++
    else if (')]}'.includes(c)) depth--
    else if (!depth && /\s/.test(c)) {
      let [hit = '', op] = code.slice(i).match(/^\s+(->|~>|throws)\s/) ?? []
      if (op == '->' || op == '~>' || op == 'throws') {
        let actual = code.slice(0, i)
        return { actual, op, expected: code.slice(i + hit.length).trimStart() }
      }
    }
  }
}

let LANGS = /^(ts|tsx|js|jsx|mjs|mts|typescript|javascript)$/

/** Whether a page is a module, whose doc comments hold its examples. */
export let module = (path: string) => /\.[mc]?[jt]sx?$/.test(path)

/// fences('```ts\nf()\n```')[0] -> { line: 1, skip: false, lang: 'ts', code: 'f()' }
/// fences('/**\n * ```ts ignore\n * f()\n * ```\n */', 'a.ts')[0] ~> { line: 2, skip: true }
/// fences('```json\n{}\n```') -> []
/**
 * The fenced examples in a page: every block in a Markdown page, and in a
 * module every block inside a doc comment, its ` * ` margin taken off.
 */
export let fences = (source: string, path = 'page.md'): Fence[] => {
  let lines = source.split('\n')
  if (module(path)) {
    let doc = false
    lines = lines.map((text) => {
      let open = doc || /^\s*\/\*\*/.test(text)
      doc = open && !text.includes('*/')
      return open ? text.replace(/^\s*(\/\*\*|\*\/|\*(?!\/))? ?/, '') : ''
    })
  }
  let out: Fence[] = []
  let open:
    | { line: number; skip: boolean; lang: string; margin: number }
    | undefined
  let body: string[] = []
  for (let [i, text] of lines.entries()) {
    let fence = text.match(/^(\s*)```(\S*)\s*(.*)$/)
    if (open && fence && !fence[2]) {
      let { line, skip, lang } = open
      out.push({ line, skip, lang, code: body.join('\n') })
      open = undefined
    } else if (open) body.push(text.slice(open.margin))
    else if (fence && LANGS.test(fence[2])) {
      open = {
        line: i + 1,
        skip: /\bignore\b/.test(fence[3]),
        lang: fence[2],
        margin: fence[1].length,
      }
      body = []
    } else if (fence) {
      // Another language's block, or plain text: skip to its close, so what
      // it holds is never read as a fence of its own.
      let close = lines.findIndex((l, j) => j > i && /^\s*```\s*$/.test(l))
      lines.fill('', i, close < 0 ? lines.length : close + 1)
    }
  }
  return out
}

// Statements an example opens with that a module holds at its top level.
let IMPORT = /^import[\s{*'"]/
let ENDS =
  /(^import\s*['"][^'"]+['"]|\bfrom\s*['"][^'"]+['"])(\s+with\s*\{[^}]*\})?\s*;?\s*$/

/// unexport('export default worker({') -> 'void worker({'
/// unexport('export class Shop {') -> 'class Shop {'
/// unexport("export * from './x.ts'") -> ''
/**
 * A line of an example as a statement in a function body: what it exported
 * it still declares, a default export is only evaluated, and a re-export is
 * gone.
 */
export let unexport = (line: string) =>
  /^export\s+(\*|\{)/.test(line)
    ? ''
    : line.replace(/^export\s+default\s+/, 'void ').replace(/^export\s+/, '')

/// hoist("import { a } from 'x'\nimport {\n  b,\n} from 'y'\na(b)") -> { imports: ["import { a } from 'x'", "import {\n  b,\n} from 'y'"], rest: ['', '', '', '', 'a(b)'] }
/** An example's import statements, and the rest of its lines with blanks
 * where the imports stood, so the lines keep their numbers. */
export let hoist = (code: string) => {
  let imports: string[] = [], rest: string[] = []
  let open: string[] | undefined
  for (let text of code.split('\n')) {
    if (!open && IMPORT.test(text)) open = []
    if (open) {
      open.push(text)
      rest.push('')
      if (ENDS.test(text)) {
        imports.push(open.join('\n'))
        open = undefined
      }
    } else rest.push(unexport(text))
  }
  return { imports, rest }
}

/// bound("import d, { a, b as c, type T } from 'x'") -> ['d', 'a', 'c', 'T']
/// bound("import * as ns from 'x'") -> ['ns']
/// bound("import 'x'") -> []
/** The names an import statement binds. */
export let bound = (statement: string): string[] =>
  (statement.match(/^import\s+(?:type\s+)?([\s\S]*?)\s*from\s/)?.[1] ?? '')
    .replace(/\*\s+as\s+/, '')
    .replace(
      /\{([\s\S]*)\}/,
      (_, list: string) =>
        list.split(',').map((s) =>
          s.trim().replace(/^type\s+/, '').split(/\s+as\s+/).at(-1)
        ).join(','),
    )
    .split(/[\s,]+/).filter((n) => /^[A-Za-z_$][\w$]*$/.test(n))

/// specifiers("import { a } from 'x'\nimport 'y'") -> ['x', 'y']
/** What an example's imports name. */
export let specifiers = (code: string) =>
  hoist(code).imports.map((s) =>
    s.match(/(?:^import|\bfrom)\s*['"]([^'"]+)/)?.[1]
  )
    .filter((s): s is string => !!s)

// Words that cannot be bound by a destructuring pattern.
let RESERVED = new Set(
  ('break case catch class const continue debugger default delete do else ' +
    'enum export extends false finally for function if import in ' +
    'instanceof new null return super switch this throw true try typeof ' +
    'var void while with yield let static implements interface package ' +
    'private protected public await arguments eval').split(' '),
)

/** The names a module exports that an example can use unimported. */
export let usable = (exports: string[], taken: string[] = []) =>
  exports.filter((n) =>
    /^[A-Za-z_$][\w$]*$/.test(n) && !RESERVED.has(n) && !taken.includes(n)
  )

// The first line of a compiled module: the imports it hoists, all on one
// line, and the opening of the test's body. `$test` and the checks are
// named with a `$` so an example's own names never meet them.
let head = (parts: string[]) =>
  parts.map((p) => p.replace(/\s*\n\s*/g, ' '))
    .join('; ')

/// imported(['a', 'b'], 'm.ts') -> "import { a, b } from './m.ts'"
/// imported([], 'm.ts') -> "import './m.ts'"
/**
 * The page, with the exports an example uses unimported imported by name, so
 * each stays the live binding the page's own code assigns. The example's code
 * is a function's body, so it may declare one of those names again.
 */
export let imported = (names: string[], base: string): string =>
  names.length
    ? `import { ${names.join(', ')} } from './${base}'`
    : `import './${base}'`

// Lines `from` up to where a page's line `to` stands in a compiled module.
let pad = (from: number, to: number) => '\n'.repeat(Math.max(1, to - from))

/** Where the runner's own words are, for a compiled module to import. */
let own = (name: string) => new URL(name, import.meta.url).href

/**
 * One fenced example as a module that declares it as a test named for its
 * page and line. `exports` are the page's, for an example in a module.
 */
export let compileFence = (
  name: string,
  page: string,
  fence: Fence,
  exports: string[] = [],
) => {
  let { imports, rest } = hoist(fence.code)
  let base = page.slice(page.lastIndexOf('/') + 1)
  let names = usable(exports, imports.flatMap(bound))
  return head([
    ...imports,
    `import { test as $test } from ${JSON.stringify(own('suite.ts'))}`,
    ...module(page) ? [imported(names, base)] : [],
    `$test(${JSON.stringify(name)}, async () => {`,
  ]) + pad(1, fence.line + 1) + rest.join('\n') +
    `\n}, { skip: ${fence.skip} })\n`
}

/**
 * A page's doctests as one module: its statements run in order, and each
 * check declares a test named for its line and code.
 */
export let compileDoctests = (
  page: string,
  tests: Doctest[],
  exports: string[] = [],
) => {
  let base = page.slice(page.lastIndexOf('/') + 1)
  let lines = 1
  let body = ''
  let at = (line: number) => {
    body += pad(lines, line)
    lines = Math.max(lines + 1, line)
  }
  for (let t of tests) {
    at(t.line)
    let parts = split(t.code)
    let check = !parts
      ? t.skip ? '' : t.code
      : `$test(${
        JSON.stringify(`${page}:${t.line} ${t.code.split('\n')[0]}`)
      }, async () => ${
        parts.op == '->'
          ? `$equal(${parts.actual}, ${parts.expected})`
          : parts.op == '~>'
          ? `$match(await (${parts.actual}), ${parts.expected})`
          : `$throws(() => ${parts.actual}, ${parts.expected})`
      }, { skip: ${t.skip} })`
    body += check
    lines += t.code.split('\n').length - 1
  }
  return head([
    `import { test as $test } from ${JSON.stringify(own('suite.ts'))}`,
    `import { equal as $equal, match as $match, throws as $throws } from ${
      JSON.stringify(own('assert.ts'))
    }`,
    imported(usable(exports), base),
    'await (async () => {',
  ]) + body + '\n})()\n'
}
