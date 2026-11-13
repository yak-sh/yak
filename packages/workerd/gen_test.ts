// A config imports only the store facets its packages export, once per facet.
import { equal, test, throws } from '@yaks/testing'
import { type Eager, imports, loader, named } from './gen.ts'

// One eager table of `specifiers`.
let table = (name: string, specifiers: string[]): Eager[] => [{
  name,
  type: 'unknown',
  using: ['X', 'x'],
  specifiers,
  says: name,
}]

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

test('store loader generation imports vocabulary eagerly and code lazily', () => {
  let source = loader([
    'a/vocab',
    'b/graph',
    'yak/domain/vocab',
    'yak/domain/effects',
  ], {
    'yak/domain/vocab': './domain-vocab.ts',
    'yak/domain/effects': './domain-effects.ts',
  })
  equal(
    [...source.matchAll(/import\(([^)]+)\)/g)].map((m) => JSON.parse(m[1])),
    ['b/graph', './domain-effects.ts'],
  )
  equal(
    [...source.matchAll(/import \* as eager0_\d+ from ("[^"\n]+")/g)].map((m) =>
      JSON.parse(m[1])
    ),
    ['a/vocab', './domain-vocab.ts'],
  )
})

test('store import generation takes the union of explicitly selected facets', () => {
  equal(
    imports(
      [
        {
          plugins: [{ use: 'a', facets: ['vocab'] }, { use: 'b', facets: [] }],
        },
        { plugins: [{ use: 'a', facets: ['effects'] }] },
      ],
      ['a', 'b'].map((name) => ({
        name,
        exports: {
          './vocab': './vocab.ts',
          './graph': './graph.ts',
          './effects': './effects.ts',
          './tools': './tools.ts',
        },
      })),
    ),
    ['a/vocab', 'a/effects'],
  )
})

test('a named facet is imported eagerly, and a plugin exporting none is refused', async () => {
  let manifests = [
    { name: 'p', exports: { './provider': './provider.ts' } },
    { name: 'q', exports: './mod.ts' },
  ]
  equal(
    named(
      { plugins: [{ use: 'p', with: { k: 1 } }, 'p'] },
      manifests,
      'provider',
    ),
    [
      'p/provider',
    ],
  )
  await throws(
    () => named({ plugins: ['q'] }, manifests, 'provider'),
    'q exports no ./provider',
  )
  let eager = /import \* as eager1_\d+ from ("[^"\n]+")/g
  equal(
    [...loader([], {}, table('providers', ['p/provider'])).matchAll(eager)].map(
      (m) => JSON.parse(m[1]),
    ),
    ['p/provider'],
  )
})
