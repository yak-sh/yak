// The browser module graph must stay inside src/, the server's one static
// root, and may name only bare specifiers the import map resolves. Deno can
// resolve an import outside it, or a `node:` builtin, that the browser cannot:
// typechecking alone cannot catch a module that becomes a production 404 or a
// CORS error. A `node:path` import in client.ts (browser-shared) took the whole
// UI down this way — fetched at page load, before any function runs — past a
// test that only ever looked at RELATIVE imports. So this walk sees every
// import, and a bare one must be in the import map or it fails here.
//
// And a bare specifier resolves TWO ways: `deno check` maps `lucide-preact` to
// the full `npm:lucide-preact` in deno.json, but the browser maps it to the
// curated subset in `src/vendor/` through index.html's import map. So a NAMED
// import the vendored subset doesn't export typechecks green and dies at page
// load — `does not provide an export named 'MessageCircle'` took the UI down
// exactly this way. The export-provision test below resolves each bare import
// through the SAME map the browser uses and asserts its target really exports
// every name imported, so this class fails at the gate, not in the fleet's tab.
import { assert } from '@std/assert'

// Every module specifier, with the leading `type` if the whole clause is one.
// `import type { X } from 'node:sqlite'` is ERASED by sucrase before the file
// is served, so it never reaches the browser and must not fail here — only a
// VALUE import survives compilation. A mixed `import { type A, b }` keeps the
// import for `b`, so its head is a bare `import {…` (no leading `type`) and is
// checked, which is right. Group 1 is ` type` for a type-only clause; group 3
// is the specifier. The `from`-less forms — `import('x')`, `import 'x'` — carry
// no `type` and are always checked.
let specifiers = /\bimport\b(\s+type\b)?(?:[^'"]*?\bfrom\s*)?(["'])([^"']+)\2/g

// A static import that BINDS names: `import <clause> from 'spec'`. Group 1 is
// the clause (default / `* as ns` / `{ named }`), group 3 the specifier. A
// type-only `import type …` is skipped — erased by sucrase, no runtime binding.
// Side-effect (`import 'x'`) and dynamic (`import('x')`) bind nothing, so they
// never match and need no export to be provided.
let clauses = /\bimport\s+(?!type\b)([^'";]*?)\bfrom\s*(["'])([^"']+)\2/g

// The value-side names a clause pulls from its module: the source name of each
// `{ a, b as c }` entry (type-only entries erased), plus `default` when a
// default binding is present. `* as ns` binds the whole namespace, so it needs
// no single export and contributes nothing to check.
let bound = (clause: string): string[] => {
  let brace = clause.match(/\{([^}]*)\}/)
  let names = brace
    ? brace[1]
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s && !/^type\b/.test(s))
      .map((s) => s.split(/\bas\b/)[0].trim())
    : []
  // A default binding is a leading identifier before any brace — `import X …`
  // or `import X, { … } …`. `* as ns` starts with `*` and is not one.
  let head = clause.replace(/\{[^}]*\}/, '').replace(/,/g, ' ').trim()
  if (head && !head.startsWith('*')) names.push('default')
  return names
}

// The names a module provides: every `export { a, b as c }` (and re-export
// `export { … } from '…'`) taking the EXPORTED (right) name, each named
// `export const|let|var|function|class X`, and `default` for any default
// export. Enough for the vendored ESM the import map targets — none re-export
// with `export *`, which would hide names behind another module.
let provides = (source: string): Set<string> => {
  let names = new Set<string>()
  for (let m of source.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (let part of m[1].split(',')) {
      let name = part.trim()
      if (!name) continue
      let as = name.split(/\bas\b/)
      names.add((as[1] ?? as[0]).trim())
    }
  }
  let decl =
    /export\s+(?:(?:async\s+)?function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g
  for (let m of source.matchAll(decl)) names.add(m[1])
  if (/export\s+default\b/.test(source)) names.add('default')
  return names
}

// index.html's import map, specifier → target, derived not hand-listed: a new
// vendored dep is allowed the moment it is mapped, and an UNmapped bare import
// (a `node:` builtin, a stray npm name) fails whether or not anyone updated
// this test.
let importMap = async (root: URL): Promise<Map<string, string>> => {
  let html = await Deno.readTextFile(new URL('index.html', root))
  let block = html.match(/<script type="importmap">([\s\S]*?)<\/script>/)
  assert(block, 'index.html has no import map')
  let map = JSON.parse(block![1]) as { imports: Record<string, string> }
  return new Map(Object.entries(map.imports))
}

let isRelative = (s: string) => s.startsWith('./') || s.startsWith('../')

// The target file a mapped specifier resolves to — the browser serves the map's
// values from the static root, so a root-absolute `/vendor/x` hangs off root
// and a relative `./x` resolves against it.
let mapped = (root: URL, to: string): URL =>
  to.startsWith('/') ? new URL(to.slice(1), root) : new URL(to, root)

// The files the browser actually loads, walked from main.tsx through the
// relative imports (vendored files are the map's leaves, not walked). A
// relative import that escapes the static root is a production 404, so the walk
// refuses one as it goes.
let served = async (root: URL): Promise<Map<string, string>> => {
  let files = new Map<string, string>()
  let queue = [new URL('main.tsx', root)]
  while (queue.length) {
    let file = queue.shift()!
    if (files.has(file.href)) continue
    let source = await Deno.readTextFile(file)
    files.set(file.href, source)
    for (let match of source.matchAll(specifiers)) {
      if (match[1]) continue // import type … — erased by sucrase, never served
      let spec = match[3]
      if (!isRelative(spec)) continue
      let child = new URL(spec, file)
      child.search = ''
      assert(
        child.href.startsWith(root.href),
        `${file.pathname} imports outside the static root: ${spec}`,
      )
      if (/\.[jt]sx?$/.test(child.pathname)) queue.push(child)
    }
  }
  return files
}

Deno.test('the mobile viewport does not scale the app shell', async () => {
  let html = await Deno.readTextFile(new URL('index.html', import.meta.url))
  let viewport = html.match(/<meta\s+name="viewport"\s+content="([^"]+)"/)
  assert(viewport, 'index.html has no viewport metadata')
  let content = new Set(viewport[1].split(',').map((part) => part.trim()))
  assert(content.has('maximum-scale=1'))
  assert(content.has('user-scalable=no'))
})

Deno.test('the browser graph stays in src/ and names only mapped bare imports', async () => {
  let root = new URL('.', import.meta.url)
  let map = await importMap(root)
  for (let [href, source] of await served(root)) {
    let file = new URL(href)
    for (let match of source.matchAll(specifiers)) {
      let spec = match[3]
      if (match[1] || isRelative(spec)) continue
      // A bare specifier the browser cannot resolve on its own — it must be
      // named in the import map. `node:*` builtins never are, which is the
      // class that broke the UI.
      assert(
        map.has(spec),
        `${file.pathname} imports a bare specifier the import map does not resolve: ${spec}`,
      )
    }
  }
})

Deno.test('every named import is provided by its vendored target', async () => {
  let root = new URL('.', import.meta.url)
  let map = await importMap(root)
  // The vendored targets, read once — this is what the BROWSER loads, where the
  // gap lives: `deno check` validates the npm module deno.json names, never
  // these curated subsets.
  let exports = new Map<string, Set<string>>()
  let provided = async (to: string): Promise<Set<string>> => {
    let file = mapped(root, to)
    let hit = exports.get(file.href)
    if (hit) return hit
    let set = provides(await Deno.readTextFile(file))
    exports.set(file.href, set)
    return set
  }
  for (let [href, source] of await served(root)) {
    let file = new URL(href)
    for (let match of source.matchAll(clauses)) {
      let spec = match[3]
      let to = map.get(spec)
      if (!to) continue // bare-but-unmapped is the other test's failure
      let has = await provided(to)
      for (let name of bound(match[1])) {
        assert(
          has.has(name),
          `${file.pathname} imports { ${name} } from '${spec}', but its ` +
            `browser target ${to} does not export it — typechecks against the ` +
            `npm module, breaks at page load.`,
        )
      }
    }
  }
})
