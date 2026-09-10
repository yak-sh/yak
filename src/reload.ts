// The server module graph that needs a process handoff — WALKED from server.ts,
// never listed. The dev supervisor and the browser hot-reload watcher share
// this predicate, so neither can mistake a backend edit for a client-only swap.
// A hand-kept list of this graph fell eight modules behind twice under a
// passing test; deriving it makes the completeness true by construction.
//
// The classifier re-walks on each filesystem event. Imports can be added while
// the supervisor stays alive; freezing this set at module import made every
// later edit to a newly imported child look client-only, leaving old server
// code behind a freshly served browser.

// A module specifier — every import form that carries a string literal. Group 1
// is a type-only clause's ` type`, which sucrase erases before the file is
// served or run, so it is skipped; group 3 is the specifier. The connector
// between `import` and the quote is one of three shapes: a dynamic call
// (`import('x')`, `await import('x')`), a binding + `from`
// (`import x from 'x'`), or nothing at all (a side-effect `import 'x'`). The
// last two `from`-less forms carry no `type` and are always followed.
let specifiers =
  /\bimport\b(\s+type\b)?\s*(?:\(\s*|(?:[^'"]*?\bfrom\s*)?)(["'])([^"']+)\2/g

// Every value-import specifier `source` names, in order — match[3] of each
// import whose clause is not `type`. Lifted out of graph() so the grammar can
// be driven by a string alone: a walk over sampled files can never prove a form
// is covered, only a walk over the forms themselves can. Returns bare and
// relative specifiers alike; graph() keeps only the relative ones.
///   imports("import a from './a'\nimport './b'\nimport('./c')")
///     -> ['./a', './b', './c']
///   imports("import type { T } from './t'") -> []
export let imports = (source: string): string[] => {
  let out: string[] = []
  for (let match of source.matchAll(specifiers)) {
    if (match[1]) continue // import type … — erased by sucrase, never runs
    out.push(match[3])
  }
  return out
}

let isRelative = (s: string) => s.startsWith('./') || s.startsWith('../')

// Package barrels carry runtime dependencies via re-exports, too. Keep this
// extension on the supervisor's walk: the browser's src-only graph is unchanged.
let reexports =
  /\bexport\s+(?!type\b)(?:\*\s*(?:as\s+\w+\s*)?|\{[^}]*\}\s*)from\s*(["'])([^"']+)\1/g

// Every module `entry` statically imports, transitively, relative to `root`.
// By default this is src/, preserving the browser's server-edit boundary. Value
// imports only; an `import type` is gone before anything runs. This reads
// source files, so it is server/dev-only — nothing the browser reaches may
// import this module.
export let graph = (
  entry = 'server.ts',
  root = new URL('.', import.meta.url),
  workspace = false,
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
    // must never join the graph, or serverFile would claim a phantom module.
    names.add(file.pathname.slice(root.pathname.length))
    let specs = imports(source)
    if (workspace) {
      for (let match of source.matchAll(reexports)) specs.push(match[2])
    }
    for (let spec of specs) {
      let child: URL
      if (isRelative(spec)) child = new URL(spec, file)
      else {
        if (!workspace) continue
        try {
          child = new URL(import.meta.resolve(spec))
        } catch {
          continue // not a workspace module known to this supervisor
        }
      }
      child.search = ''
      if (!child.href.startsWith(root.href)) continue
      if (!/\.[jt]sx?$/.test(child.pathname)) continue
      queue.push(child)
    }
  }
  return names
}

let named = (files: Iterable<string>) => {
  let list = [...files]
  return (path: string) => list.some((file) => path.endsWith(`/${file}`))
}

export let serverClassifier = (
  entry = 'server.ts',
  root = new URL('.', import.meta.url),
) => {
  return (path: string) => named(graph(entry, root))(path)
}

export let serverFile = serverClassifier()

// The doing owner reaches outside src/ through workspace package imports.
// Re-walk on every event just like serverFile: a newly imported dependency
// must be reloadable without restarting the supervisor first.
export let effectsGraph = () =>
  graph('src/effectsd.ts', new URL('../', import.meta.url), true)

export let processFile = (path: string) =>
  serverFile(path) || named(effectsGraph())(path)

// Watch only source trees, not .git, databases, or node_modules at repo root.
export let processRoots = ['.', '../packages'].map((path) =>
  new URL(path, import.meta.url).pathname
)

// The supervisor's OWN module graph — the files dev.ts imports. These need a
// supervisor relaunch (dev.ts, exit 42), not a handoff, because a process
// cannot replace the code it already imported. Kept by hand because it stays
// small, guarded by the test that reads dev.ts's imports and requires every one
// named here — so an added import (bind.ts, for the lost-race check) fails that
// test until it joins this list.
export let devFiles = ['dev.ts', 'reload.ts', 'bind.ts']

export let devFile = named(devFiles)
