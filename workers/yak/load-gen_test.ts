// A config imports only the store facets its packages export, once per facet.
import { equal, test, throws } from '@yaks/testing'
import { imports, loader, providers } from './load-gen.ts'

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
    [...source.matchAll(/import \* as vocab\d+ from ("[^"\n]+")/g)].map((m) =>
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

test('provider generation imports each named provider eagerly and refuses one serving none', async () => {
  let manifests = [
    { name: 'p', exports: { './provider': './provider.ts' } },
    { name: 'q', exports: './mod.ts' },
  ]
  equal(
    providers({ plugins: [{ use: 'p', with: { k: 1 } }, 'p'] }, manifests),
    [
      'p/provider',
    ],
  )
  await throws(
    () => providers({ plugins: ['q'] }, manifests),
    'q exports no ./provider',
  )
  let eager = /import \* as provider\d+ from ("[^"\n]+")/g
  equal(
    [...loader(['p/provider']).matchAll(eager)].map((m) => JSON.parse(m[1])),
    ['p/provider'],
  )
})
