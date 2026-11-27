import { equal, ok, test } from '@yaks/testing'
import { parse } from 'es-module-lexer/js'
import { compile } from './compile.ts'
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

// A toolkit of two packages, one importing the other, compiled as an app's
// pages and run from where the host would serve them.
let kit = (name: string, files: Record<string, string>, deps = {}) => ({
  files: {
    'package.json': JSON.stringify({
      exports: Object.fromEntries(
        Object.keys(files).map((f) => [
          f == 'mod.ts' ? '.' : `./${f.replace(/\.ts$/, '')}`,
          `./${f}`,
        ]),
      ),
    }),
    ...files,
  },
  dependencies: deps,
  version: `sha256:${(name.length % 10).toString().repeat(64)}`,
  resources: { 'Button.css': '.Button {}' },
})
let served = async (
  pages: Record<string, string>,
  together: string[][] = [],
) => {
  let dir = await Deno.makeTempDir()
  let origin = `file://${dir}`
  let answer = await compile({
    files: {
      'package.json': JSON.stringify({
        dependencies: { '@yaks/kit': 'platform', '@yaks/more': 'platform' },
      }),
      ...pages,
    },
    pages: Object.keys(pages),
    together,
  }, {
    '@yaks/kit': kit('@yaks/kit', {
      'mod.ts': 'let n = 0\nexport let bump = () => ++n\n' +
        "export let sheet = new URL('./Button.css', import.meta.url).href",
      'lazy.ts': "export { bump as later } from './mod.ts'\n" +
        'globalThis.lazy = true',
    }),
    '@yaks/more': kit('@yaks/more', {
      'mod.ts': "export { bump as more } from '@yaks/kit'\n" +
        'globalThis.more = true',
    }, { '@yaks/kit': 'platform' }),
  }, origin)
  let all = { ...answer.shared, ...answer.pages }
  for (let [path, text] of Object.entries(all)) {
    await Deno.mkdir(`${dir}/${path}`.replace(/\/[^/]*$/, ''), {
      recursive: true,
    })
    await Deno.writeTextFile(`${dir}/${path}`, text)
  }
  return {
    answer,
    origin,
    run: (page: string) => import(`${origin}/${page}`),
    statics: (page: string) => [
      ...new Set(
        parse(answer.pages[page])[0].filter((i) => i.d == -1).map((i) =>
          i.n!.replace(/[^/]*$/, '')
        ),
      ),
    ],
    done: () => Deno.remove(dir, { recursive: true }),
  }
}

test('pages loaded together import one pack, and a module two of them import is one instance', async () => {
  let s = await served({
    'w.ts': "import { bump } from '@yaks/kit'\nexport let n = bump()",
    'a.ts': "import { bump, sheet } from '@yaks/kit'\n" +
      'export let n = bump(), at = sheet',
    'b.ts':
      "import { more } from '@yaks/more'\nimport * as kit from '@yaks/kit'\n" +
      'export let n = more() + kit.bump() * 10',
    'c.ts': "export let later = () => import('@yaks/kit/lazy')\n" +
      '  .then((m) => m.later())',
  }, [['a.ts', 'b.ts'], ['b.ts', 'c.ts']])
  try {
    equal(s.answer.errors, [])
    // A script no HTML page loads with another, such as a module worker,
    // evaluates only what it imports.
    equal([(await s.run('w.ts')).n, 'more' in globalThis], [1, false])
    ok(!s.statics('w.ts').includes(s.statics('a.ts')[0]))
    // What each page loads before it runs comes from one directory.
    let [pack] = s.statics('a.ts')
    equal([s.statics('a.ts'), s.statics('b.ts'), s.statics('c.ts')], [
      [pack],
      [pack],
      [],
    ])
    ok(s.answer.pages['a.ts'].includes(`${pack}pack.js`))
    let a = await s.run('a.ts'), b = await s.run('b.ts')
    let c = await s.run('c.ts')
    // A lazy import evaluates its module when it runs, not before.
    equal('lazy' in globalThis, false)
    equal([a.n, b.n, await c.later()], [1, 2 + 3 * 10, 4])
    equal('lazy' in globalThis, true)
    // A module's resources load from beside it in its group.
    ok(a.at.startsWith(`${s.origin}/__packages/`) && !a.at.startsWith(pack))
    equal(s.answer.shared![a.at.slice(s.origin.length + 1)], '.Button {}')
  } finally {
    await s.done()
  }
})
