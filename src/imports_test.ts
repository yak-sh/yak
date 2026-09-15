// The walker's grammar, driven by strings — the teeth of this file. A path-
// sampling test can pass while a whole import FORM goes unrecognized (side-
// effect and dynamic imports both matched nothing until T-16648); only feeding
// every form and asserting the exact specifier set proves the coverage.
import { assertEquals } from '@std/assert'
import { pathToFileURL } from 'node:url'
import { graph, imports } from './imports.ts'

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
    ] as [string, string[]][]
  ) assertEquals(imports(source), want, source)
})
