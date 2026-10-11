import { equal, test } from '@yaks/testing'
import { imports } from './parser.ts'

test('TSX metadata keeps its literal dynamic dependency', () => {
  equal(
    imports(`
      import type { Shape } from './erased.ts'
      let { docs } = await import('./metadata.json')
      export let view = <section>{docs.title}</section>
    `),
    ['./metadata.json'],
  )
})

test('TS runtime bindings and callback imports survive type erasure', () => {
  equal(
    imports(
      `
      import type Shape from './erased.ts'
      import { type as value } from './value.ts'
      export { type Shape } from './erased.ts'
      export { type as alias } from './exported.ts'
      let cast = <string>value
      function later() { return import(\`./callback.ts\`) }
    `,
      'source.ts',
    ),
    ['./value.ts', './exported.ts', './callback.ts'],
  )
})

test('excluded callbacks leave metadata and other function dependencies tracked', () => {
  equal(
    imports(
      `
      import {} from './static.ts'
      let metadata = await import('./metadata.ts')
      let commands = [
        {run: async () => import('./arrow.ts')},
        {run: async function() { return import('./function.ts') }},
        {async run() { return import('./method.ts') }},
        {run: await import('./data.ts')},
      ]
      function outside() { return import('./outside.ts') }
    `,
      'source.ts',
      ['run'],
    ),
    ['./static.ts', './metadata.ts', './data.ts', './outside.ts'],
  )
})
