// A config imports only the store facets its packages export, once per facet.
import { equal, test, throws } from '@yaks/testing'
import { imports, loader } from './load-gen.ts'

test('store import generation resolves options and deduplicates configs', async () => {
  equal(
    imports([
      { plugins: [{ use: 'a', with: { limit: 1 }, words: ['row'] }, 'b'] },
      { plugins: ['a'] },
    ], [
      {
        name: 'a',
        exports: {
          './vocab': './words.ts',
          './effects': './effects.ts',
          './service': './service.ts',
          './routes': './routes.ts',
        },
      },
      { name: 'b', exports: './mod.ts' },
    ]),
    ['a/vocab', 'a/effects'],
  )
  await throws(
    () => imports([{ plugins: ['missing'] }], []),
    'no manifest for missing',
  )
})

test('store loader generation emits literal dynamic imports', () => {
  let source = loader(['a/vocab', 'b/graph'])
  equal(
    [...source.matchAll(/import\(([^)]+)\)/g)].map((m) => JSON.parse(m[1])),
    [
      'a/vocab',
      'b/graph',
    ],
  )
})
