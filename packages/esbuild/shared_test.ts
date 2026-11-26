import { equal, test } from '@yaks/testing'
import { analysisCache } from './analysis.ts'
import { external } from './shared.ts'
import { Files } from './npm.ts'
import { type Catalog, seed } from './platform.ts'

let catalog: Catalog = {
  '@yaks/analysis-fixture': {
    files: {
      'package.json': JSON.stringify({ exports: { '.': './index.js' } }),
      'index.js': "export { a } from 'analysis-fixture'",
    },
    dependencies: { 'analysis-fixture': '1' },
    version: `sha256:${'d'.repeat(64)}`,
  },
}
let files = {
  'package.json': JSON.stringify({
    dependencies: { '@yaks/analysis-fixture': 'platform' },
  }),
  'main.js': "export { a } from 'analysis-fixture'; import './later.js'",
}
let setup = seed(files, catalog)
let make = () =>
  new Files({
    ...setup.files,
    'node_modules/analysis-fixture/package.json': JSON.stringify({
      type: 'module',
      exports: './index.js',
    }),
    'node_modules/analysis-fixture/index.js':
      'export let a = 101; export let b = 202',
  })

let fixture = () => {
  let cache = analysisCache<string[]>(
    4096,
    (value) => Promise.resolve(JSON.stringify(value)),
  )
  let fs = make()
  let calls = 0
  let analyze = () =>
    cache('same manifest', (path) => fs.read(path), (source) => {
      calls++
      return Promise.resolve(
        ['main.js', 'later.js', 'node_modules/analysis-fixture/index.js']
          .map((path) => source.read(path) ?? 'missing'),
      )
    })
  return {
    analyze,
    get calls() {
      return calls
    },
    get fs() {
      return fs
    },
    fresh() {
      fs = make()
    },
  }
}

test('analysis cache reuses unchanged reads but not page edits', async () => {
  let f = fixture()
  let first = await f.analyze()
  equal(await f.analyze(), first)
  equal(f.calls, 1)
  f.fs.write('main.js', 'changed page')
  equal((await f.analyze())[0], 'changed page')
  equal(f.calls, 2)
})

test('analysis cache validates missing resolution targets', async () => {
  let f = fixture()
  equal((await f.analyze())[1], 'missing')
  f.fs.write('later.js', 'new resolution target')
  equal((await f.analyze())[1], 'new resolution target')
  equal(f.calls, 2)
})

test('analysis cache validates deleted resolution targets', async () => {
  let f = fixture()
  f.fs.write('later.js', 'resolved target')
  await f.analyze()
  f.fs.delete('later.js')
  equal((await f.analyze())[1], 'missing')
  equal(f.calls, 2)
})

test('analysis cache validates installed npm sources', async () => {
  let f = fixture()
  await f.analyze()
  f.fs.write('node_modules/analysis-fixture/index.js', 'changed npm source')
  equal((await f.analyze())[2], 'changed npm source')
  equal(f.calls, 2)
})

test('analysis cache validates fresh Files at the same manifest identity', async () => {
  let f = fixture()
  f.fs.write('node_modules/analysis-fixture/index.js', 'changed npm source')
  await f.analyze()
  f.fresh()
  equal((await f.analyze())[2], 'export let a = 101; export let b = 202')
  equal(f.calls, 2)
})

test('an unserved toolkit import names what the platform serves of it', () => {
  let refusal = (spec: string) => {
    try {
      return external({ '@yaks/md': 'u', '@yaks/md/site': 'v' })!(
        spec,
        'main.ts',
        {},
      )
    } catch (e) {
      return (e as Error).message
    }
  }
  equal(
    refusal('@yaks/md/away'),
    "@yaks/md/away: the platform's @yaks/md has no such browser export; it " +
      'exports @yaks/md, @yaks/md/site. Import one of those, or deploy ' +
      "again once the platform's @yaks/md exports it",
  )
  equal(
    refusal('@yaks/ui'),
    '@yaks/ui: missing browser package in the platform catalog; declare ' +
      '@yaks/ui in package.json dependencies',
  )
  equal(refusal('@yaks/md/site'), 'v')
  equal(refusal('left-pad'), undefined)
})
