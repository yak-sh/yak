// What a file says about itself, read from its text: the opening comment that
// says what the file is for, the modules it imports, the title and body of a
// markdown document, and the exports `deno doc --json` found in it.
//
// Everything here is a pure function of text (or of `deno doc`'s JSON), so it
// runs anywhere and tests without a checkout. ./sync.ts does the reading from
// disk and the writing to the graph.
//
// The opening comment is read here rather than taken from `deno doc`, because
// `deno doc` only keeps a `/** */` block tagged as the module's, and most files
// in this repository open with a `//` paragraph instead.

import { front } from '@yaks/yaml'

/** Is this a file whose exports `deno doc` can read? */
export let isCode = (path: string): boolean => /\.(ts|tsx|js|mjs)$/.test(path)

/** Is this a markdown document? */
export let isMarkdown = (path: string): boolean => path.endsWith('.md')

// Lines that open a file without saying anything about it: a shebang, a
// tool's directive, a triple-slash reference.
let directive = /^(#!|\/\/\/\s*<|\/\/\s*(deno-|@ts-|eslint|prettier))/

/**
 * A file's opening comment, as prose: a leading `/** *\/` or `/* *\/` block,
 * or the run of `//` lines the file starts with. Blank comment lines keep the
 * paragraphs apart; the first line of code ends it.
 *
 * ```ts
 * header('// Owns the store.\n//\n// Nothing else.\nlet x = 1')
 * // 'Owns the store.\n\nNothing else.'
 * ```
 */
export let header = (text: string): string => {
  let lines = text.split('\n')
  let i = 0
  while (i < lines.length && (!lines[i].trim() || directive.test(lines[i]))) i++
  let first = lines[i]?.trim() ?? ''
  let out: string[] = []
  if (first.startsWith('/*')) {
    for (; i < lines.length; i++) {
      let line = lines[i].trim()
      let end = line.includes('*/')
      line = line.replace(/^\/\*\*?/, '').replace(/\*\/.*$/, '')
        .replace(/^\*\s?/, '')
      out.push(line)
      if (end) break
    }
  } else {
    for (; i < lines.length; i++) {
      let line = lines[i].trim()
      if (!line.startsWith('//')) break
      if (directive.test(line)) continue
      out.push(line.replace(/^\/\/\s?/, ''))
    }
  }
  return out.join('\n').replace(/^\s*@module\s*$/m, '').trim()
}

// An import or re-export statement at the start of a line, so a statement
// quoted inside a doc comment (` * import { x } from 'y'`) is never read as
// one: `import x from`, `import * as x from`, `import { a, b } from`,
// `export * from`, `export { a } from`, `export type { a } from`.
let statement =
  /^(?:import|export)\s+(?:type\s+)?(?:[\w$]+\s*,?\s*)?(?:\*(?:\s+as\s+[\w$]+)?\s*)?(?:\{[^}]*\}\s*)?from\s*['"]([^'"\n]+)['"]/gm
let bare = /^import\s*['"]([^'"\n]+)['"]/gm

/**
 * The specifiers a module imports or re-exports, in the order it names them,
 * each once.
 *
 * ```ts
 * specifiers("import { a } from './a.ts'\nexport * from '@yaks/git'")
 * // ['./a.ts', '@yaks/git']
 * ```
 */
export let specifiers = (text: string): string[] => [
  ...new Set(
    [...text.matchAll(statement), ...text.matchAll(bare)]
      .sort((a, b) => a.index - b.index).map((m) => m[1]),
  ),
]

/** A package as its manifest describes it: where it is and what it exports. */
export type Manifest = {
  /** the manifest's own path */
  path: string
  /** the directory it governs, `''` for the repository root */
  dir: string
  name: string
  version?: string
  description?: string
  /** subpath → file, relative to `dir` */
  exports: Record<string, string>
}

/** A `deno.json`'s package, or nothing when it publishes no name. */
export let manifest = (path: string, text: string): Manifest | undefined => {
  let json: Record<string, unknown>
  try {
    json = JSON.parse(text)
  } catch {
    return undefined
  }
  if (typeof json.name != 'string' || !json.name) return undefined
  let dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
  let ex = json.exports
  let exports = typeof ex == 'string'
    ? { '.': ex }
    : ex && typeof ex == 'object'
    ? ex as Record<string, string>
    : {}
  return {
    path,
    dir,
    name: json.name,
    ...(typeof json.version == 'string' ? { version: json.version } : {}),
    ...(typeof json.description == 'string'
      ? { description: json.description }
      : {}),
    exports,
  }
}

/** The package a path belongs to: the manifest in its nearest directory. */
export let owner = (
  path: string,
  pkgs: Manifest[],
): Manifest | undefined =>
  pkgs.filter((p) => !p.dir || path.startsWith(p.dir + '/'))
    .sort((a, b) => b.dir.length - a.dir.length)[0]

let join = (dir: string, rel: string): string => {
  let parts = dir ? dir.split('/') : []
  for (let part of rel.split('/')) {
    if (part == '..') parts.pop()
    else if (part && part != '.') parts.push(part)
  }
  return parts.join('/')
}

let within = (dir: string, file: string) => join(dir, file.replace(/^\.\//, ''))

/**
 * The repository path a specifier names, from the module at `from`: a relative
 * path, or a package of this repository by its published name and subpath.
 * Anything else — a registry, a URL, a package from elsewhere — names no file
 * here and resolves to nothing.
 *
 * ```ts
 * resolve('./b.ts', 'src/a.ts', [])                  // 'src/b.ts'
 * resolve('@yaks/git/cites', 'src/a.ts', [git])      // 'packages/git/cites.ts'
 * ```
 */
export let resolve = (
  spec: string,
  from: string,
  pkgs: Manifest[],
): string | undefined => {
  if (spec.startsWith('.')) {
    return join(from.slice(0, Math.max(0, from.lastIndexOf('/'))), spec)
  }
  for (let p of pkgs) {
    if (spec != p.name && !spec.startsWith(p.name + '/')) continue
    let sub = '.' + spec.slice(p.name.length)
    let file = p.exports[sub]
    return file ? within(p.dir, file) : undefined
  }
  return undefined
}

/** A markdown document's title and body: the frontmatter's `doc.title` or
 * the first `#` heading, else the file's name; the body after frontmatter. */
export let markdown = (
  path: string,
  text: string,
): { title: string; body: string } => {
  let body = text
  let said: unknown
  try {
    let got = front(text, path)
    body = got.body
    said = (got.meta.doc as { title?: unknown } | undefined)?.title
  } catch { /* frontmatter that does not parse is text */ }
  let heading = body.match(/^#\s+(.+)$/m)?.[1]?.trim()
  let title = typeof said == 'string' && said ? said : heading
  return { title: title || path.slice(path.lastIndexOf('/') + 1), body }
}

/** One export, as `deno doc` describes it. */
export type Export = { name: string; kind: string; line: number; doc: string }

/** One module in `deno doc --json` output, as far as this package reads it. */
export type DocNode = {
  symbols?: {
    name: string
    declarations?: {
      location: { filename: string; line: number }
      declarationKind: string
      kind: string
      jsDoc?: { doc?: string }
    }[]
  }[]
}

/**
 * The exports a module declares itself, from `deno doc --json` output: a
 * re-export belongs to the module that declares it, and an overloaded name
 * is one export at its first declaration.
 */
export let exportsOf = (
  nodes: Record<string, DocNode>,
  url: string,
): Export[] => {
  let out: Export[] = []
  for (let s of nodes[url]?.symbols ?? []) {
    let d = s.declarations?.find((d) =>
      d.declarationKind == 'export' && d.kind != 'reference' &&
      d.location.filename == url
    )
    if (!d || out.some((e) => e.name == s.name)) continue
    out.push({
      name: s.name,
      kind: d.kind,
      line: d.location.line,
      doc: d.jsDoc?.doc?.trim() ?? '',
    })
  }
  return out
}
