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

// Every module `entry` statically imports, transitively, as basenames within
// src/ — the server's one static root, which the walk never leaves. Value
// imports only; an `import type` is gone before anything runs. This reads
// source files, so it is server/dev-only — nothing the browser reaches may
// import this module.
export let graph = (
  entry = 'server.ts',
  root = new URL('.', import.meta.url),
): Set<string> => {
  let queue = [new URL(entry, root)]
  let seen = new Set<string>()
  let names = new Set<string>([entry])
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
    for (let spec of imports(source)) {
      if (!isRelative(spec)) continue
      let child = new URL(spec, file)
      child.search = ''
      if (!child.href.startsWith(root.href)) continue
      if (!/\.[jt]sx?$/.test(child.pathname)) continue
      names.add(child.pathname.slice(root.pathname.length))
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

// The supervisor's OWN module graph — dev.ts imports this file and nothing
// else. These files still need a supervisor relaunch because a process cannot
// replace the code it already imported (dev.ts, exit 42).
export let devFiles = ['dev.ts', 'reload.ts']

export let devFile = named(devFiles)
