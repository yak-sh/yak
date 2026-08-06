// The server module graph that needs a process handoff — WALKED from server.ts,
// never listed. The dev supervisor and the browser hot-reload watcher share
// this predicate, so neither can mistake a backend edit for a client-only swap.
// A hand-kept list of this graph fell eight modules behind twice under a
// passing test; deriving it makes the completeness true by construction.
//
// The walk runs once, when this module is first imported. A running supervisor
// decides by the graph it walked at ITS start and nothing re-walks it in place,
// so a landed change to a server file cannot reach the process screening the
// events. That is why this file is a devFile as well as a server one: landing
// relaunches the supervisor (dev.ts, exit 42), and the names the fresh process
// decides by are then the tree's.

// A module specifier — the same shape browser_test.ts matches. Group 1 is a
// type-only clause's ` type`, which sucrase erases before the file is served or
// run, so it is skipped; group 3 is the specifier. The `from`-less forms
// (`import 'x'`, `import('x')`) carry no `type` and are always followed.
let specifiers = /\bimport\b(\s+type\b)?(?:[^'"]*?\bfrom\s*)?(["'])([^"']+)\2/g

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
    for (let match of source.matchAll(specifiers)) {
      if (match[1]) continue // import type … — erased by sucrase, never runs
      let spec = match[3]
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

export let serverFiles = graph()

let named = (files: Iterable<string>) => {
  let list = [...files]
  return (path: string) => list.some((file) => path.endsWith(`/${file}`))
}

export let serverFile = named(serverFiles)

// The supervisor's OWN module graph — dev.ts imports this file and nothing
// else. It is the server graph above that makes this one necessary: a landed
// name there restarts the child, but the supervisor keeps deciding by the graph
// it walked at its start, so the tree and the process disagree about what a
// server file even is until the supervisor relaunches (dev.ts, exit 42).
export let devFiles = ['dev.ts', 'reload.ts']

export let devFile = named(devFiles)
