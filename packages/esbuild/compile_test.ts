import { equal, match, test } from '@yaks/testing'
import { parse } from 'es-module-lexer/js'
import { bundle, Stopped } from './bundle.ts'
import compiler, { compile, type Job } from './compile.ts'
import type { Answer, Ask } from './plan.ts'
import { type Catalog, seed } from './platform.ts'
import { Files } from './npm.ts'
import { shared } from './shared.ts'

// A toolkit package from the catalog, so no compile here reaches a registry.
// Its `import` condition, after a `require` one, names its module, which
// imports one beside it.
let catalog: Catalog = {
  '@yaks/kit': {
    files: {
      'package.json': JSON.stringify({
        exports: { '.': { require: './gone.cjs', import: './lib/mod.ts' } },
      }),
      'lib/mod.ts': "export { n } from './n'",
      'lib/n.ts': 'export let n: number = 1',
    },
    dependencies: {},
    version: `sha256:${'a'.repeat(64)}`,
  },
}
let declared = JSON.stringify({ dependencies: { '@yaks/kit': 'platform' } })

let page = (files: Record<string, string>): Ask => ({
  files: { 'package.json': declared, ...files },
  pages: ['main.ts'],
})
let worker = (source: string, flags: string[] = []): Ask => ({
  files: { 'package.json': declared, 'worker.ts': source },
  worker: { entry: 'worker.ts', flags, carry: [] },
  pages: [],
})

let imports = (code: string) => parse(code)[0].map((i) => i.n).sort()
let run = (code: string, shared: Answer['shared'] = {}) => {
  let urls = new Map<string, string>()
  let encode = (text: string) =>
    `data:text/javascript,${encodeURIComponent(text).replaceAll("'", '%27')}`
  let rewrite = (text: string, at: string): string => {
    for (let imp of parse(text)[0].toReversed()) {
      if (!imp.n) continue
      let url = new URL(imp.n, at)
      let path = url.pathname.slice(1)
      if (!(path in shared)) continue
      let child = urls.get(path)
      if (!child) {
        child = encode(rewrite(shared[path], url.href)) +
          `#${encodeURIComponent(path)}`
        urls.set(path, child)
      }
      text = text.slice(0, imp.s) + child + text.slice(imp.e)
    }
    return text
  }
  return import(encode(rewrite(code, 'https://yaks.app/main.js')))
}

test('the server compiles a posted job into one module per page', async () => {
  let job: Job = {
    shared: true,
    ask: page({
      'main.ts': "import { n } from '@yaks/kit'\n" +
        "import { twice } from './lib/twice'\n" +
        'export let out: string = twice(n) + process.env.NODE_ENV',
      'lib/twice.ts': 'export let twice = (n: number) => n * 2',
    }),
    catalog,
  }
  let res = await compiler.fetch(
    new Request('http://compiler/', {
      method: 'POST',
      body: JSON.stringify(job),
    }),
  )
  let got: Answer = await res.json()
  equal(got.errors, [])
  let urls = imports(got.pages['main.ts'])
  equal(urls.length, 1)
  match(
    urls[0]!,
    /^https:\/\/yaks\.app\/__packages\/[a-f0-9]{64}\/entry-0\.js$/,
  )
  equal((await run(got.pages['main.ts'], got.shared)).out, '2production')
  let bundled = await compiler.fetch(
    new Request('http://compiler/', {
      method: 'POST',
      body: JSON.stringify({ ...job, shared: undefined }),
    }),
  ).then((res) => res.json()) as Answer
  equal(bundled.errors, [])
  equal(bundled.shared, undefined)
  equal(imports(bundled.pages['main.ts']), [])
  equal((await run(bundled.pages['main.ts'])).out, '2production')

  let extra: Catalog = {
    ...catalog,
    '@yaks/extra': {
      files: {
        'package.json': JSON.stringify({ exports: { '.': './mod.ts' } }),
        'mod.ts': "export { n } from '@yaks/kit'",
      },
      dependencies: { '@yaks/kit': 'platform' },
      version: `sha256:${'b'.repeat(64)}`,
    },
  }
  let second = await compile({
    files: {
      'package.json': JSON.stringify({
        dependencies: { '@yaks/extra': 'platform' },
      }),
      'other/main.ts': "export { n } from '@yaks/extra'",
    },
    pages: ['other/main.ts'],
  }, extra)
  equal(second.errors, [])
  for (let [path, code] of Object.entries(got.shared!)) {
    equal(second.shared![path], code)
  }
  equal((await run(second.pages['other/main.ts'], second.shared)).n, 1)
  let changed = structuredClone(catalog)
  // A caller-provided digest cannot make changed content reuse stale code.
  changed['@yaks/kit'].files['lib/n.ts'] = 'export let n = 2'
  let newer = await compile(job.ask, changed)
  equal(newer.errors, [])
  equal(imports(newer.pages['main.ts'])[0] == urls[0], false)
  equal((await run(newer.pages['main.ts'], newer.shared)).out, '4production')
  let browser: Catalog = structuredClone(catalog)
  browser['@yaks/kit'].dependencies.preact = '10.29.8'
  browser['@yaks/kit'].files['lib/mod.ts'] +=
    "\nexport { options } from 'preact'"
  let preact = {
    'node_modules/preact/package.json': JSON.stringify({
      version: '10.29.8',
      exports: { '.': './mod.js', './hooks': './hooks.js' },
    }),
    'node_modules/preact/mod.js': 'export let options = {}',
    'node_modules/preact/hooks.js': "export { options } from './mod.js'",
  }
  let setup = seed(job.ask.files, browser)
  let fs = new Files({ ...setup.files, ...preact })
  let modules = await shared(fs, setup, browser, 'https://yaks.app')
  let singleton =
    `import { options as kit } from '${modules.urls['@yaks/kit']}';` +
    `import { options } from '${modules.urls.preact}';` +
    `import { options as hooks } from '${modules.urls['preact/hooks']}';` +
    'export let same = kit === options && options === hooks'
  equal((await run(singleton, modules.files)).same, true)
  fs.write(
    'node_modules/preact/mod.js',
    'export let options = { changed: true }',
  )
  let mutated = await shared(fs, setup, browser, 'https://yaks.app')
  equal(mutated.urls.preact == modules.urls.preact, false)
  equal(mutated.urls['@yaks/kit'] == modules.urls['@yaks/kit'], false)
  let twins: Catalog = {}
  for (let name of ['@yaks/first', '@yaks/second']) {
    twins[name] = {
      files: {
        'package.json': JSON.stringify({ exports: { '.': './mod.ts' } }),
        'mod.ts': 'export let state = {}',
      },
      dependencies: {},
      version: `sha256:${'a'.repeat(64)}`,
    }
  }
  let twinSetup = seed({
    'package.json': JSON.stringify({
      dependencies: { '@yaks/first': 'platform', '@yaks/second': 'platform' },
    }),
  }, twins)
  let distinct = await shared(
    new Files(twinSetup.files),
    twinSetup,
    twins,
    'https://yaks.app',
  )
  let states = await run(
    `import { state as first } from '${distinct.urls['@yaks/first']}';` +
      `import { state as second } from '${distinct.urls['@yaks/second']}';` +
      'first.changed = true; export let independent = !second.changed',
    distinct.files,
  )
  equal(states.independent, true)
})

test("a worker keeps its runtime's imports and bundles the rest", async () => {
  let got = await compile(
    worker(
      "import { DurableObject } from 'cloudflare:workers'\n" +
        "import { Buffer } from 'node:buffer'\n" +
        "import { n } from '@yaks/kit'\n" +
        'export default { n, DurableObject, Buffer }',
      ['nodejs_compat'],
    ),
    catalog,
  )
  equal(got.errors, [])
  equal(got.worker!.main, 'worker.js')
  equal(imports(got.worker!.code), ['cloudflare:workers', 'node:buffer'])
})

test("an app's mistakes come back as lines that say where", async () => {
  for (
    let [ask, said] of [
      [page({ 'main.ts': 'let x = (' }), /^main\.ts:1:10: Unexpected end/],
      [
        page({ 'main.ts': "export { n } from '@yaks/kit/absent'" }),
        /missing browser.*export/,
      ],
      [
        page({ 'main.ts': "export { n } from '@yaks/absent'" }),
        /missing browser.*package/,
      ],
      [
        page({
          'main.ts': "import { u } from './util.js'\nconsole.log(u)",
          'util.ts': 'export let u = 1',
        }),
        /imports \.\/util\.js, which is util\.ts/,
      ],
      [
        worker("import pad from 'left-pad'\nexport default pad"),
        /name left-pad in package\.json dependencies/,
      ],
    ] as const
  ) {
    let got = await compile(ask, catalog)
    equal(got.errors.length, 1, String(got.errors))
    match(got.errors[0], said)
  }
  let bad = structuredClone(catalog)
  for (let spec of ['./missing.js', '../../../private.ts', '/private.ts']) {
    bad['@yaks/kit'].files['lib/mod.ts'] = `export { n } from '${spec}'`
    let got = await compile(
      page({
        'main.ts': "export { n } from '@yaks/kit'",
        'private.ts': 'export let n = "PRIVATE"',
      }),
      bad,
    )
    equal(got.errors.length, 1)
    match(got.errors[0], /no emitted file/)
  }
})

// esbuild's own process, a child of this one.
let esbuild = () =>
  new TextDecoder().decode(
    new Deno.Command('pgrep', { args: ['-P', String(Deno.pid)] })
      .outputSync().stdout,
  ).split('\n').find((pid) =>
    pid && Deno.readTextFileSync(`/proc/${pid}/cmdline`).includes('--service')
  )

test('a build whose esbuild ends throws Stopped, and the next starts esbuild again', async () => {
  let reads = 0
  let files = {
    read: (path: string) => {
      // The second read is esbuild loading the entry, mid-build.
      if (++reads == 2) Deno.kill(Number(esbuild()), 'SIGKILL')
      return path == 'a.ts' ? 'export let a: number = 1' : null
    },
  }
  let threw = await bundle(files, 'a.ts').catch((e) => e)
  equal(threw instanceof Stopped, true, String(threw))
  equal((await run((await bundle(files, 'a.ts')).code)).a, 1)
})
