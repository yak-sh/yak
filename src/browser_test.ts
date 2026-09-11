// Check the module graph the browser loads, including workspace re-exports.
// Deno resolves bare imports through deno.json; the browser uses index.html,
// where a missing mapping, source file, or vendored export breaks page load.
import { assert } from '@std/assert'
import { init, parse } from 'es-module-lexer'
import { transform } from 'sucrase'

// Source names bound by an import or named re-export. The lexer isolates the
// statement, so comments and example code cannot create phantom imports.
let bound = (statement: string): string[] => {
  let clause = statement.match(/^(?:import|export)\s*([\s\S]*?)\bfrom\s*['"]/)
    ?.[1]
  if (!clause) return []
  let brace = clause.match(/\{([^}]*)\}/)
  let names = brace
    ? brace[1].split(',').map((s) => s.trim()).filter(Boolean)
      .map((s) => s.split(/\bas\b/)[0].trim())
    : []
  let head = clause.replace(/\{[^}]*\}/, '').replace(/,/g, ' ').trim()
  if (head && !head.startsWith('*')) names.push('default')
  return names
}

let root = new URL('.', import.meta.url)
let packages = new URL('../packages/', root)
// Resolve imports as browser URLs first. A package's ../../src/x.ts is
// /src/x.ts on the wire, which the app serves from src/src/x.ts. Resolving
// filesystem paths first would incorrectly bless that production 404.
let mapped = (to: string): URL => new URL(to, 'http://browser/')
let local = (file: URL): URL =>
  file.pathname.startsWith('/packages/')
    ? new URL(file.pathname.slice('/packages/'.length), packages)
    : new URL(file.pathname.slice(1), root)

type Module = {
  exports: Set<string>
  imports: { target: string; statement: string }[]
}

let served = async (): Promise<Map<string, Module>> => {
  await init
  let html = await Deno.readTextFile(new URL('index.html', root))
  let block = html.match(/<script type="importmap">([\s\S]*?)<\/script>/)
  assert(block, 'index.html has no import map')
  let map =
    (JSON.parse(block[1]) as { imports: Record<string, string> }).imports
  let files = new Map<string, Module>()
  // Check every mapped entry too: an unused export may become a caller's next
  // import, and each package's mod.ts must be loadable on its own.
  let queue = [mapped('/main.tsx'), ...Object.values(map).map(mapped)]
  while (queue.length) {
    let file = queue.shift()!
    file.search = ''
    if (files.has(file.href)) continue
    let path = local(file)
    assert(
      path.href.startsWith(root.href) || path.href.startsWith(packages.href),
      `${file.pathname} is outside the browser's static roots`,
    )
    let source = await Deno.readTextFile(path)
    let module: Module = { exports: new Set(), imports: [] }
    files.set(file.href, module)
    if (file.pathname.endsWith('.json')) {
      JSON.parse(source)
      module.exports.add('default')
      continue
    }
    if (/\.tsx?$/.test(file.pathname)) {
      source = transform(source, {
        transforms: ['typescript', 'jsx'],
        jsxRuntime: 'automatic',
        jsxImportSource: 'preact',
        production: true,
        filePath: file.pathname,
      }).code
    }
    let [imports, exports] = parse(source)
    module.exports = new Set(exports.map((entry) => entry.n))
    for (let entry of imports) {
      let spec = entry.n
      if (!spec) continue // import.meta or a nonliteral dynamic import
      let child: URL
      if (spec.startsWith('./') || spec.startsWith('../')) {
        child = new URL(spec, file)
      } else if (spec.startsWith('/')) {
        child = mapped(spec)
      } else {
        assert(
          map[spec],
          `${file.pathname} imports an unmapped bare specifier: ${spec}`,
        )
        child = mapped(map[spec])
      }
      child.search = ''
      module.imports.push({
        target: child.href,
        statement: entry.d == -1 ? source.slice(entry.ss, entry.se) : '',
      })
      queue.push(child)
    }
  }
  // Export-star chains may cross packages and cycles. Propagate to a fixed
  // point so registration/traversal order cannot hide a provided name.
  let changed = true
  while (changed) {
    changed = false
    for (let module of files.values()) {
      for (let { target, statement } of module.imports) {
        if (!/^export\s*\*\s*from\b/.test(statement)) continue
        for (let name of files.get(target)!.exports) {
          if (name == 'default' || module.exports.has(name)) continue
          module.exports.add(name)
          changed = true
        }
      }
    }
  }
  return files
}

Deno.test('the mobile viewport does not scale the app shell', async () => {
  let html = await Deno.readTextFile(new URL('index.html', root))
  let viewport = html.match(/<meta\s+name="viewport"\s+content="([^"]+)"/)
  assert(viewport, 'index.html has no viewport metadata')
  let content = new Set(viewport[1].split(',').map((part) => part.trim()))
  assert(content.has('maximum-scale=1'))
  assert(content.has('user-scalable=no'))
})

Deno.test('the browser graph resolves through its static roots and import map', async () => {
  let files = await served()
  for (let [href, module] of files) {
    for (let { target, statement } of module.imports) {
      // The graph walk has already checked every dependency, including JSON
      // imports, dynamic imports and export-star targets. Named bindings must
      // additionally exist in what the browser serves, especially curated ESM.
      for (let name of bound(statement)) {
        assert(
          files.get(target)!.exports.has(name),
          `${new URL(href).pathname} imports { ${name} } from ` +
            `${new URL(target).pathname}, which does not export it`,
        )
      }
    }
  }
})

// crypto.randomUUID is gated to SECURE contexts, and this app is served over
// plain http on the tailnet — there the property is simply not a function, so
// the first write throws out of a layout effect and the canvas never paints.
// types.ts `uuid` (and @yaks/id `mint`) build a v4 from getRandomValues, which
// is gated nowhere. Browser code mints through those, always.
Deno.test('browser code mints uuids outside a secure context', async () => {
  let files = await served()
  let gated: string[] = []
  for (let href of files.keys()) {
    let path = local(new URL(href))
    if (!/\.tsx?$/.test(path.pathname)) continue
    let source = await Deno.readTextFile(path)
    if (source.includes('crypto.randomUUID(')) {
      gated.push(new URL(href).pathname)
    }
  }
  assert(
    !gated.length,
    `${gated.join(', ')} name crypto.randomUUID(), which is absent on plain ` +
      `http — mint with uuid() from types.ts (or mint() from @yaks/id)`,
  )
})
