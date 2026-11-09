import { equal, test } from '@yaks/testing'
import { assertStringIncludes } from '@std/assert'
import { pageModule } from './page-module-probe.ts'

let at = 'https://yaks.app/manage/clerk/operator'
let sources: Record<string, string> = {
  '/parts/main.js': `
    import './side.js'
    export { value as default } from './value.js'
    export let base = import.meta.url
  `,
  '/parts/side.js': 'globalThis.loaded++',
  '/parts/value.js': 'export let value = 42',
  '/parts/later.js': 'globalThis.loaded++; export let value = 43',
}
let load = (source: string) =>
  pageModule(source, {
    at,
    globals: { loaded: 0 },
    read: (url) => {
      let source = sources[new URL(url).pathname]
      if (source == undefined) throw new Error(`Not found: ${url}`)
      return Promise.resolve(source)
    },
  })
let source = `
  import value, {
    base as address
  } from '/parts/main.js'
  import * as again from '/parts/main.js'
  let [later, twice] = await Promise.all([import('/parts/later.js'), import('/parts/later.js')])
  export let seen = [value, again.default, later.value, twice.value, address, loaded]
`

test('a page loads its import graph by address once per window, with its own globals', async () => {
  for (let i = 0; i < 2; i++) {
    equal(Array.from((await load(source)).seen as unknown[]), [
      42,
      42,
      43,
      43,
      'https://yaks.app/parts/main.js',
      2,
    ])
  }
})

test('a page fails when an imported file or export is missing, or a bare specifier is unmapped', async () => {
  for (
    let [source, message] of [
      ["import '/missing.js'", 'Not found'],
      ["import { missing } from '/parts/main.js'", 'missing'],
      ["import 'unmapped'", 'Unmapped module specifier'],
    ]
  ) {
    let error = await load(source).then(() => '', String)
    assertStringIncludes(error, message)
  }
})
