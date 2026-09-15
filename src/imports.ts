// The browser's module graph, WALKED from an entry — never listed. Three
// users: the server warms its transform cache over main.tsx's graph before it
// binds, so the first page after a boot is no slower than every page after it;
// the shell preloads the served graph so a boot fetches it in one wave; and a
// test asserts a library reaches no live-database module. A hand-kept list of
// a graph fell eight modules behind twice under a passing test; deriving it
// makes the completeness true by construction.

// A module specifier — every import form that carries a string literal, and
// the re-export forms (`export * from`, `export { a } from`) that are imports
// too: a `mod.ts` made of them fetched 53 unstamped, uncacheable modules on
// every refresh while the walker saw none of them (T-37445). Group 1 is a
// type-only clause's ` type`, which sucrase erases before the file is served or
// run, so it is skipped; group 3 is the specifier. The connector between
// `import` and the quote is one of three shapes: a dynamic call (`import('x')`,
// `await import('x')`), a binding + `from` (`import x from 'x'`), or nothing at
// all (a side-effect `import 'x'`). An `export` must carry `*` or a `{…}` list
// and then `from`, so `export let s = './x'` stays a string.
import { fileURLToPath } from 'node:url'
let specifiers =
  /\b(?:import\b(\s+type\b)?\s*(?:\(\s*|(?:[^'"]*?\bfrom\s*)?)|export\b(\s+type\b)?\s+(?:\*(?:\s+as\s+\w+)?|\{[^}]*\})\s+from\s*)(["'])([^"']+)\3/g

// Every value-import specifier `source` names, in order — match[4] of each
// import whose clause is not `type`. Lifted out of graph() so the grammar can
// be driven by a string alone: a walk over sampled files can never prove a form
// is covered, only a walk over the forms themselves can. Returns bare and
// relative specifiers alike; graph() keeps only the relative ones.
///   imports("import a from './a'\nimport './b'\nimport('./c')")
///     -> ['./a', './b', './c']
///   imports("import type { T } from './t'") -> []
///   imports("export * from './x'\nexport { a } from './y'") -> ['./x', './y']
export let imports = (source: string): string[] => {
  let out: string[] = []
  for (let match of source.matchAll(specifiers)) {
    if (match[1] || match[2]) continue // … type … — erased by sucrase
    out.push(match[4])
  }
  return out
}

let isRelative = (s: string) => s.startsWith('./') || s.startsWith('../')

// The cache-busting stamp (T-37445): every relative value-import specifier in
// a served module gets `?v=<gen>`, so the browser can hold the module
// immutable and a new gen names a fresh URL. Bare specifiers resolve through
// the import map, which the shell stamps itself.
///   stamp("import a from './a.ts'\nimport 'preact'", 7)
///     -> "import a from './a.ts?v=7'\nimport 'preact'"
///   stamp("export * from './x.ts'", 7) -> "export * from './x.ts?v=7'"
export let stamp = (source: string, gen: number): string =>
  source.replace(
    specifiers,
    (all, type, etype, q, spec) =>
      type || etype || !isRelative(spec)
        ? all
        : `${all.slice(0, -spec.length - 1)}${spec}?v=${gen}${q}`,
  )

// Every module `entry` statically imports, transitively, relative to `root`
// (src/ by default). Value imports only; an `import type` is gone before
// anything runs. This reads source files, so it is server/test-only — nothing
// the browser reaches may import this module.
export let graph = (
  entry = 'main.tsx',
  root = new URL('.', import.meta.url),
): Set<string> => {
  let queue = [new URL(entry, root)]
  let seen = new Set<string>()
  let names = new Set<string>()
  while (queue.length) {
    let file = queue.shift()!
    if (seen.has(file.href)) continue
    seen.add(file.href)
    let source: string
    try {
      source = Deno.readTextFileSync(file)
    } catch {
      continue // a specifier the walk can't read is not a source file we own
    }
    // Name a file only once it has READ — a specifier lifted from a comment or
    // string (imports() is a text scanner, not a parser) points at no file and
    // must never join the graph.
    names.add(fileURLToPath(file).slice(fileURLToPath(root).length))
    for (let spec of imports(source)) {
      if (!isRelative(spec)) continue
      let child = new URL(spec, file)
      child.search = ''
      if (!child.href.startsWith(root.href)) continue
      if (!/\.[jt]sx?$/.test(child.pathname)) continue
      queue.push(child)
    }
  }
  return names
}

// The graph as the BROWSER sees it: served paths (`/main.tsx`,
// `/packages/graph/mod.ts`, `/vendor/preact.module.js`), bare specifiers
// resolved through the shell's import map, in discovery order from the entry.
// A `/packages/` path lives beside src/ in the repo; everything else under
// src/. This is what the shell preloads (server_runtime.ts): the browser then
// asks for the whole graph in one wave instead of finding it a level at a time.
///   served('/main.tsx', {}, new URL('file:///nowhere/')) -> []
export let served = (
  entry: string,
  map: Record<string, string>,
  src = new URL('.', import.meta.url),
): string[] => {
  let fileOf = (path: string) =>
    new URL(path.startsWith('/packages/') ? `..${path}` : `.${path}`, src)
  let queue = [entry]
  let seen = new Set<string>()
  while (queue.length) {
    let path = queue.shift()!
    if (seen.has(path)) continue
    let source: string
    try {
      source = Deno.readTextFileSync(fileOf(path))
    } catch {
      continue
    }
    seen.add(path)
    for (let spec of imports(source)) {
      let next = isRelative(spec)
        ? new URL(spec, `http://_${path}`).pathname
        : map[spec]
      if (next && /\.m?[jt]sx?$/.test(next)) queue.push(next)
    }
  }
  return [...seen]
}
