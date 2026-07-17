// The stamp: every relative import re-fetches under ?v=<gen>; the shell
// (live.ts, types.ts) stays unversioned so state singletons survive swaps.
import { assertEquals } from '@std/assert'
import { stamp } from './hot.ts'

let cases: [string, string][] = [
  [
    `import { x } from './components/App.tsx'`,
    `import { x } from './components/App.tsx?v=7'`,
  ],
  [`import { cache } from '../live.ts'`, `import { cache } from '../live.ts'`],
  [`import { comps } from './types.ts'`, `import { comps } from './types.ts'`],
  [`export { block } from './ui.tsx'`, `export { block } from './ui.tsx?v=7'`],
  [`import './side.ts'`, `import './side.ts?v=7'`],
  [`import { render } from 'preact'`, `import { render } from 'preact'`],
  [`await import("./x.tsx")`, `await import("./x.tsx?v=7")`],
  [`import a from './alive.ts'`, `import a from './alive.ts?v=7'`],
]

Deno.test('stamp versions the swappable set, spares the shell', () => {
  for (let [js, want] of cases) assertEquals(stamp(js, 7), want)
})
