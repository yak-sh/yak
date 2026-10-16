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

// Exercise emitted code in one minified bundle: dynamic imports must become
// deferred module initializers, not eager JSON parsing hidden behind a getter.
let { build, stop } = await import('npm:esbuild@0.28.1')
let built = await build({
  stdin: {
    contents: loader(['base/vocab', 'extra/vocab', 'unused/vocab'], {}, [
      'base/vocab',
    ]) + '\nexport { evaluated } from "state"',
    resolveDir: Deno.cwd(),
    loader: 'ts',
  },
  bundle: true,
  format: 'esm',
  minify: true,
  write: false,
  plugins: [{
    name: 'facets',
    setup(build) {
      build.onResolve({ filter: /.*/ }, ({ path }) => ({
        path,
        namespace: 'facets',
      }))
      build.onLoad({ filter: /.*/, namespace: 'facets' }, ({ path }) => ({
        contents: path == 'state'
          ? 'export let evaluated = []'
          : `import { evaluated } from 'state'; evaluated.push(${
            JSON.stringify(path)
          });
            export let docs = [JSON.parse('{"title":"${path}"}')];`,
        loader: 'ts',
      }))
    },
  }],
})
stop()
let bundled = await import(
  `data:text/javascript;base64,${
    btoa(built.outputFiles![0].text + `\n// ${crypto.randomUUID()}`)
  }`
)

test('one bundled loader evaluates only selected package vocabulary, once', async () => {
  equal(bundled.evaluated, ['base/vocab'])
  await throws(() => bundled.vocabFacet('extra'), 'has not been loaded')
  equal(bundled.vocabFacet('missing'), null)
  let [a, b] = await Promise.all([
    bundled.load('extra', 'vocab'),
    bundled.load('extra', 'vocab'),
  ])
  equal(a, b)
  equal(bundled.vocabFacet('extra'), a)
  equal(a.docs, [{ title: 'extra/vocab' }])
  equal(bundled.evaluated, ['base/vocab', 'extra/vocab'])
  equal(await bundled.load('missing', 'vocab'), null)
})
