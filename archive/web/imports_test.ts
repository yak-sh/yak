// The walker's grammar, driven by strings — the teeth of this file. A path-
// sampling test can pass while a whole import FORM goes unrecognized (side-
// effect and dynamic imports both matched nothing until T-16648); only feeding
// every form and asserting the exact specifier set proves the coverage.
import { assertEquals } from '@std/assert'
import { pathToFileURL } from 'node:url'
import { graph, imports, served, stamp } from './imports.ts'

Deno.test('graph: file URL paths are decoded once', () => {
  let dir = Deno.makeTempDirSync({ prefix: 'tasks-imports-# %23 ' })
  try {
    Deno.writeTextFileSync(`${dir}/entry.ts`, "import './child%23%20%2523.ts'")
    Deno.writeTextFileSync(`${dir}/child# %23.ts`, 'export let value = 1')
    assertEquals(
      graph('entry.ts', pathToFileURL(dir + '/')),
      new Set(['entry.ts', 'child# %23.ts']),
    )
  } finally {
    Deno.removeSync(dir, { recursive: true })
  }
})

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
      // A re-export is an import too (T-37445).
      [`export * from './star'`, ['./star']],
      [`export * as ns from './starAs'`, ['./starAs']],
      [`export { a, type B } from './list'`, ['./list']],
      [`export {\n  a,\n} from './multiList'`, ['./multiList']],
      [`export type { T } from './typed'`, []],
      // A string that merely follows `export` is not a specifier.
      [`export let s = './no'`, []],
    ] as [string, string[]][]
  ) assertEquals(imports(source), want, source)
})

Deno.test('stamp: relative value imports carry the generation, nothing else does', () => {
  let source = [
    `import { a } from './a.ts'`,
    `import type { T } from './t.ts'`,
    `import 'preact'`,
    `import('../lazy.tsx')`,
    `import "./double.ts"`,
    `export * from './star.ts'`,
    `export { a } from './list.ts'`,
    `export type { T } from './typed.ts'`,
    `export let s = './no.ts'`,
  ].join('\n')
  assertEquals(
    stamp(source, 42),
    [
      `import { a } from './a.ts?v=42'`,
      `import type { T } from './t.ts'`,
      `import 'preact'`,
      `import('../lazy.tsx?v=42')`,
      `import "./double.ts?v=42"`,
      `export * from './star.ts?v=42'`,
      `export { a } from './list.ts?v=42'`,
      `export type { T } from './typed.ts'`,
      `export let s = './no.ts'`,
    ].join('\n'),
  )
})

Deno.test('served: the browser graph follows the import map into packages and vendor', () => {
  let dir = Deno.makeTempDirSync({ prefix: 'tasks-served-' })
  try {
    Deno.mkdirSync(`${dir}/src/vendor`, { recursive: true })
    Deno.mkdirSync(`${dir}/packages/p`, { recursive: true })
    Deno.writeTextFileSync(
      `${dir}/src/main.tsx`,
      "import './a.ts'\nimport '@yaks/p'\nimport 'lib'\nimport './a.css'",
    )
    Deno.writeTextFileSync(`${dir}/src/a.ts`, "export * from './b.ts'")
    Deno.writeTextFileSync(`${dir}/src/b.ts`, '')
    Deno.writeTextFileSync(`${dir}/src/vendor/lib.js`, '')
    Deno.writeTextFileSync(`${dir}/packages/p/mod.ts`, "import './x.ts'")
    Deno.writeTextFileSync(`${dir}/packages/p/x.ts`, "import '../../src/a.ts'")
    let map = { '@yaks/p': '/packages/p/mod.ts', lib: '/vendor/lib.js' }
    assertEquals(
      served('/main.tsx', map, pathToFileURL(`${dir}/src/`)),
      [
        '/main.tsx',
        '/a.ts',
        '/packages/p/mod.ts',
        '/vendor/lib.js',
        '/b.ts',
        '/packages/p/x.ts',
      ],
    )
  } finally {
    Deno.removeSync(dir, { recursive: true })
  }
})
