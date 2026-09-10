// The handoff boundary is a path predicate: server imports restart the process,
// while browser modules stay inside the existing hot-swap loop. serverFile is
// WALKED from server.ts (reload.ts), so the teeth here are an INDEPENDENT walk:
// this file finds server.ts's imports with its own regex and asserts the
// predicate covers every one — it fails the moment a real server import is not
// recognized, the class a sampled list could never catch. (The old test named
// this claim but sampled eight paths that all happened to be present, which is
// how eight modules went missing beneath a green suite.)
import { assert, assertEquals } from '@std/assert'
import {
  devFile,
  effectsGraph,
  graph,
  imports,
  processFile,
  processRoots,
  serverClassifier,
  serverFile,
} from './reload.ts'
import { slow } from './testing.ts'

// A second, independent copy of the walk — the oracle. If reload.ts's graph()
// ever under-walks, this still finds the module and the assert below fails. Its
// regex mirrors reload.ts's, covering every import form the grammar test pins.
let specifiers =
  /\bimport\b(\s+type\b)?\s*(?:\(\s*|(?:[^'"]*?\bfrom\s*)?)(["'])([^"']+)\2/g
let isRelative = (s: string) => s.startsWith('./') || s.startsWith('../')

// The grammar itself, driven by strings — the teeth of this file. A path-
// sampling test can pass while a whole import FORM goes unrecognized (side-
// effect and dynamic imports both matched nothing until T-16648); only feeding
// every form and asserting the exact specifier set proves the coverage.
Deno.test('imports: every import form yields its specifier', () => {
  for (
    let [source, want] of [
      // The named/default/namespace forms the walker always handled.
      [`import { a } from './named'`, ['./named']],
      [`import x from './default'`, ['./default']],
      [`import * as ns from './ns'`, ['./ns']],
      [`import x, { a, b } from './mixed'`, ['./mixed']],
      // A multiline binding list — [^'"] spans the newlines.
      [`import {\n  a,\n  b,\n} from './multi'`, ['./multi']],
      // The two forms T-16648 taught it: side-effect and dynamic.
      [`import './side'`, ['./side']],
      [`import "./side2"`, ['./side2']],
      [`import('./dyn')`, ['./dyn']],
      [`await import("./dyn2")`, ['./dyn2']],
      [`import ( './spaced' )`, ['./spaced']],
      // Two dynamic imports on one line — matchAll keeps walking.
      [`import('./a'); import('./b')`, ['./a', './b']],
      // A bare specifier is still a value import; graph() filters it, not this.
      [`import { x } from '@std/assert'`, ['@std/assert']],
      // Erased before anything runs, so never a dependency.
      [`import type { T } from './typed'`, []],
      // import.meta is not an import statement.
      [`let u = import.meta.url`, []],
    ] as [string, string[]][]
  ) assertEquals(imports(source), want, source)
})

let walk = async (entry: string, root: URL): Promise<Set<string>> => {
  let queue = [new URL(entry, root)]
  let seen = new Set<string>()
  let paths = new Set<string>()
  while (queue.length) {
    let file = queue.shift()!
    if (seen.has(file.href)) continue
    seen.add(file.href)
    // Same rule graph() honors: a specifier that names no readable file (one
    // lifted from a comment or string) is not a module — skip it, don't abort.
    let source: string
    try {
      source = await Deno.readTextFile(file)
    } catch {
      continue
    }
    paths.add(file.pathname)
    for (let match of source.matchAll(specifiers)) {
      if (match[1]) continue // import type … — erased by sucrase
      let spec = match[3]
      if (!isRelative(spec)) continue
      let child = new URL(spec, file)
      child.search = ''
      if (!child.href.startsWith(root.href)) continue
      if (!/\.[jt]sx?$/.test(child.pathname)) continue
      queue.push(child)
    }
  }
  return paths
}

// Read the real trees once; the fast-tier assertions below pin the two distinct
// boundaries without repeatedly walking hundreds of files for each path.
let src = new URL('.', import.meta.url)
let effects = effectsGraph()
let server = graph()
let originalServer = await walk('server.ts', src)
Deno.test('effectsd graph reaches workspace transport; server graph is unchanged', () => {
  assert(effects.has('src/effectsd.ts'))
  assert(effects.has('packages/openai/transport.ts'))
  assert(effects.has('packages/session/mod.ts'))
  assertEquals(
    new Set([...server].map((name) => new URL(name, src).pathname)),
    originalServer,
  )
  assertEquals(server.has('packages/openai/transport.ts'), false)
})

slow(
  'process edits include watched packages without widening browser server edits',
  () => {
    let transport = new URL('../packages/openai/transport.ts', src).pathname
    assert(processRoots.some((root) => transport.startsWith(`${root}/`)))
    assert(processFile(transport))
    assertEquals(serverFile(transport), false)
    assertEquals(processFile(`${transport}.old`), false)
    assertEquals(
      processFile(new URL('components/Card.tsx', src).pathname),
      false,
    )
  },
)

slow(
  'workspace walk follows new barrel exports, not type exports or outside files',
  () => {
    let dir = Deno.makeTempDirSync({ prefix: 'tasks-effects-reload-' })
    let root = new URL(`file://${dir}/`)
    try {
      Deno.mkdirSync(`${dir}/src`)
      Deno.mkdirSync(`${dir}/packages`)
      Deno.writeTextFileSync(
        `${dir}/src/effectsd.ts`,
        "import '../packages/mod.ts'",
      )
      Deno.writeTextFileSync(
        `${dir}/packages/mod.ts`,
        "export * from './first.ts'",
      )
      Deno.writeTextFileSync(`${dir}/packages/first.ts`, "import './mod.ts'")
      let read = () => graph('src/effectsd.ts', root, true)
      assertEquals(
        read(),
        new Set([
          'src/effectsd.ts',
          'packages/mod.ts',
          'packages/first.ts',
        ]),
      )
      Deno.writeTextFileSync(
        `${dir}/packages/mod.ts`,
        [
          "export * as first from './first.ts'",
          "export { later } from './later.ts'",
          "export type { T } from './types.ts'",
          "export * from './missing.ts'",
          "export * from '../../outside.ts'",
        ].join('\n'),
      )
      Deno.writeTextFileSync(`${dir}/packages/later.ts`, 'export let later = 1')
      Deno.writeTextFileSync(
        `${dir}/packages/types.ts`,
        'export type T = string',
      )
      assertEquals(
        read(),
        new Set([
          'src/effectsd.ts',
          'packages/mod.ts',
          'packages/first.ts',
          'packages/later.ts',
        ]),
      )
    } finally {
      Deno.removeSync(dir, { recursive: true })
    }
  },
)

slow('serverFile: covers every module server.ts imports', async () => {
  let root = new URL('.', import.meta.url)
  let reached = await walk('server.ts', root)
  assert(reached.size > 40, `walk found only ${reached.size} modules`)
  for (let path of reached) {
    assert(serverFile(path), `not a server file: ${path}`)
  }
})

// serverFile matches a path SUFFIX, not a substring: a browser module and a
// `.old` sibling of a server file are both outside the graph.
slow(
  'serverFile: matches on path suffix, so browser and .old files are out',
  () => {
    for (
      let [path, want] of [
        ['/repo/src/server.ts', true],
        ['/repo/src/reload.ts', true],
        ['/repo/src/components/Card.tsx', false],
        ['/repo/src/styles.css', false],
        ['/repo/src/server.ts.old', false],
      ] as [string, boolean][]
    ) assertEquals(serverFile(path), want, path)
  },
)

slow('serverFile: sees imports added after the classifier was made', () => {
  let dir = Deno.makeTempDirSync({ prefix: 'tasks-reload-' })
  let root = new URL(`file://${dir}/`)
  try {
    Deno.writeTextFileSync(
      `${dir}/server.ts`,
      "import { first } from './first.ts'\nvoid first\n",
    )
    Deno.writeTextFileSync(`${dir}/first.ts`, 'export let first = 1\n')
    let classify = serverClassifier('server.ts', root)
    assertEquals(classify(`${dir}/later.ts`), false)

    Deno.writeTextFileSync(
      `${dir}/server.ts`,
      "import { first } from './first.ts'\n" +
        "import { later } from './later.ts'\nvoid first\nvoid later\n",
    )
    Deno.writeTextFileSync(`${dir}/later.ts`, 'export let later = 1\n')
    assertEquals(classify(`${dir}/later.ts`), true)
  } finally {
    Deno.removeSync(dir, { recursive: true })
  }
})

// The supervisor's graph is small enough to keep by hand, so its completeness
// is guarded the cheap way: whatever dev.ts imports IS its source, and devFiles
// must name all of it or a landed supervisor change never asks for a relaunch.
Deno.test('devFile: covers everything the supervisor imports', async () => {
  let dev = await Deno.readTextFile(new URL('./dev.ts', import.meta.url))
  let imports = [...dev.matchAll(/from '\.\/([\w.]+)'/g)].map((m) => m[1])
  assertEquals(imports.length > 0, true) // the regex still finds them
  for (let name of [...imports, 'dev.ts']) {
    assertEquals(devFile(`/repo/src/${name}`), true, name)
  }
  assertEquals(devFile('/repo/src/server.ts'), false)
})
