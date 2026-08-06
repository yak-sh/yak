// The browser module graph must stay inside src/, the server's one static
// root, and may name only bare specifiers the import map resolves. Deno can
// resolve an import outside it, or a `node:` builtin, that the browser cannot:
// typechecking alone cannot catch a module that becomes a production 404 or a
// CORS error. A `node:path` import in client.ts (browser-shared) took the whole
// UI down this way — fetched at page load, before any function runs — past a
// test that only ever looked at RELATIVE imports. So this walk sees every
// import, and a bare one must be in the import map or it fails here.
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

// The bare specifiers the page actually maps — derived from index.html's
// import map, never a hand-list, so a new vendored dep is allowed the moment
// it is mapped and an UNmapped bare import (a `node:` builtin, a stray npm
// name) fails whether or not anyone updated this test.
let importMap = async (root: URL): Promise<Set<string>> => {
  let html = await Deno.readTextFile(new URL('index.html', root))
  let block = html.match(/<script type="importmap">([\s\S]*?)<\/script>/)
  assert(block, 'index.html has no import map')
  let map = JSON.parse(block![1]) as { imports: Record<string, string> }
  return new Set(Object.keys(map.imports))
}

let isRelative = (s: string) => s.startsWith('./') || s.startsWith('../')

Deno.test('the browser graph stays in src/ and names only mapped bare imports', async () => {
  let root = new URL('.', import.meta.url)
  let mapped = await importMap(root)
  let queue = [new URL('main.tsx', root)]
  let seen = new Set<string>()
  while (queue.length) {
    let file = queue.shift()!
    if (seen.has(file.href)) continue
    seen.add(file.href)
    let source = await Deno.readTextFile(file)
    for (let match of source.matchAll(specifiers)) {
      let spec = match[3]
      if (match[1]) continue // import type … — erased by sucrase, never served
      if (isRelative(spec)) {
        let child = new URL(spec, file)
        child.search = ''
        assert(
          child.href.startsWith(root.href),
          `${file.pathname} imports outside the static root: ${spec}`,
        )
        if (/\.[jt]sx?$/.test(child.pathname)) queue.push(child)
      } else {
        // A bare specifier the browser cannot resolve on its own — it must be
        // named in the import map. `node:*` builtins never are, which is the
        // class that broke the UI.
        assert(
          mapped.has(spec),
          `${file.pathname} imports a bare specifier the import map does not resolve: ${spec}`,
        )
      }
    }
  }
})
