import { equal, match, ok, test } from '@yaks/testing'
import { parse } from 'es-module-lexer/js'
import { bundle, Stopped } from './bundle.ts'
import compiler, { compile, type Job } from './compile.ts'
import type { Answer, Ask } from './plan.ts'
import { unpacked } from './unpack.ts'
import { type Catalog, seed } from './platform.ts'
import { Files } from './npm.ts'
import { registry } from './registry_fixture_test.ts'
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

// Start the file's native compiler once, outside any job's measured work.
await bundle({ read: () => '' }, 'ready.ts')

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
let changed = structuredClone(catalog)
// A caller-provided digest cannot make changed content reuse stale code.
changed['@yaks/kit'].files['lib/n.ts'] = 'export let n = 2'

let post = async (job: Job): Promise<Answer> => {
  let res = await compiler.fetch(
    new Request('http://compiler/', {
      method: 'POST',
      body: JSON.stringify(job),
    }),
  )
  equal(res.status, 200)
  let got: Answer = await res.json()
  ok(got.timing)
  let header = res.headers.get('server-timing')!
  for (let phase of ['total', 'parse', 'serialize', 'request']) {
    ok(header.includes(`compiler_${phase};dur=`))
  }
  equal(header.includes('compiler_hits;dur='), false)
  return got
}

let posted = async () => {
  let [got, bundled] = await Promise.all([
    post(job),
    post({ ...job, shared: undefined }),
  ])
  equal(got.errors, [])
  ok(got.timing!.total >= got.timing!.pages)
  let urls = imports(got.pages['main.ts'])
  equal(urls.length, 1)
  match(
    urls[0]!,
    /^https:\/\/yaks\.app\/__packages\/[a-f0-9]{64}\/entry-0\.js$/,
  )
  equal((await run(got.pages['main.ts'], got.shared)).out, '2production')
  equal(bundled.errors, [])
  equal(bundled.shared, undefined)
  equal(imports(bundled.pages['main.ts']), [])
  equal((await run(bundled.pages['main.ts'])).out, '2production')

  let [second, newer] = await Promise.all([
    compile(
      {
        files: {
          'package.json': JSON.stringify({
            dependencies: { '@yaks/extra': 'platform' },
          }),
          'other/main.ts': "export { n } from '@yaks/extra'",
        },
        pages: ['other/main.ts'],
      },
      extra,
      undefined,
      { timing: true },
    ),
    compile(job.ask, changed),
  ])
  equal(second.errors, [])
  ok(second.timing!.hits > 0)
  for (let [path, code] of Object.entries(got.shared!)) {
    equal(second.shared![path], code)
  }
  equal((await run(second.pages['other/main.ts'], second.shared)).n, 1)
  equal(newer.errors, [])
  equal(imports(newer.pages['main.ts'])[0] == urls[0], false)
  equal((await run(newer.pages['main.ts'], newer.shared)).out, '4production')
}

let singletons = async () => {
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
}

let independent = async () => {
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
}

// An npm package the page and a toolkit package both import, at two pinned
// versions: one module per compile, whichever subpath imports it, carrying
// the exports of it something uses.
let counter = (v: number) => ({
  'package.json': JSON.stringify({
    version: `${v}.0.0`,
    exports: { '.': './index.js', './more': './more.js' },
  }),
  'index.js': `export let state = { v: ${v} }\n` +
    `export let idle = () => 'idle-${v}'`,
  'more.js': "export { state as more } from './index.js'",
})
let npm = async () => {
  let { get } = registry({
    counter: { '1.0.0': counter(1), '2.0.0': counter(2) },
  })
  let stage: Catalog = {
    '@yaks/stage': {
      files: {
        'package.json': JSON.stringify({ exports: { '.': './mod.ts' } }),
        'mod.ts': "import * as counter from 'counter'\n" +
          'export let state = counter.state',
      },
      dependencies: { counter: '*' },
      version: `sha256:${'c'.repeat(64)}`,
    },
  }
  let one = "import { state } from 'counter'\n" +
    "import { more } from 'counter/more'\n" +
    "import { state as staged } from '@yaks/stage'\n" +
    'export let one = state === staged && state === more && state.v'
  // A namespace read by computed keys uses every export.
  let all = one + "\nimport * as all from 'counter'\n" +
    'export let keys = Object.keys(all)'
  let pinned = (version: string, main: string) =>
    compile(
      {
        files: {
          'package.json': JSON.stringify({
            dependencies: { '@yaks/stage': 'platform', counter: version },
          }),
          'main.ts': main,
        },
        pages: ['main.ts'],
      },
      stage,
      'https://yaks.app',
      { get, timing: true },
    )
  let [first, second] = await Promise.all([
    pinned('1.0.0', one),
    pinned('2.0.0', all),
  ])
  equal([first.errors, second.errors], [[], []])
  ok(first.timing!.carried > 0)
  ok(first.timing!.used > 0)
  ok(first.timing!.hits + first.timing!.misses > 0)
  equal((await run(first.pages['main.ts'], first.shared)).one, 1)
  let got = await run(second.pages['main.ts'], second.shared)
  equal([got.one, got.keys], [2, ['idle', 'state']])
  equal(Object.keys(first.shared!).filter((path) => path in second.shared!), [])
  let emitted = (shared: Answer['shared']) =>
    Object.entries(shared!).filter(([path]) => !path.includes('/resources/'))
      .map(([, body]) => body).join('\n')
  equal(emitted(first.shared).includes('idle-1'), false)
  equal(emitted(second.shared).includes('idle-2'), true)
}

test('the server compiles a posted job into one module per page', async () => {
  await Promise.all([
    posted(),
    singletons(),
    independent(),
    npm(),
    beside(),
    sharedBeside(),
  ])
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
  equal(got.timing, undefined)
  equal(got.worker!.main, 'worker.js')
  equal(imports(got.worker!.code), ['cloudflare:workers', 'node:buffer'])
})

// Independent bad inputs own their catalogs; no case mutates a catalog while
// another compilation is reading it.
let mistakes: [Ask, RegExp, Catalog][] = [
  [page({ 'main.ts': 'let x = (' }), /^main\.ts:1:10: Unexpected end/, catalog],
  [
    page({ 'main.ts': "export { n } from '@yaks/kit/absent'" }),
    /missing browser.*export/,
    catalog,
  ],
  [
    page({ 'main.ts': "export { n } from '@yaks/absent'" }),
    /missing browser.*package/,
    catalog,
  ],
  [
    page({
      'main.ts': "import { u } from './util.js'\nconsole.log(u)",
      'util.ts': 'export let u = 1',
    }),
    /imports \.\/util\.js, which is util\.ts/,
    catalog,
  ],
  [
    worker("import pad from 'left-pad'\nexport default pad"),
    /name left-pad in package\.json dependencies/,
    catalog,
  ],
]
for (let spec of ['./missing.js', '../../../private.ts', '/private.ts']) {
  let bad = structuredClone(catalog)
  bad['@yaks/kit'].files['lib/mod.ts'] = `export { n } from '${spec}'`
  mistakes.push([
    page({
      'main.ts': "export { n } from '@yaks/kit'",
      'private.ts': 'export let n = "PRIVATE"',
    }),
    /no emitted file/,
    bad,
  ])
}

test("an app's mistakes come back as lines that say where", async () => {
  await Promise.all(mistakes.map(async ([ask, said, catalog]) => {
    let got = await compile(ask, catalog)
    equal(got.errors.length, 1, String(got.errors))
    match(got.errors[0], said)
  }))
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

// An npm package that names a file beside its module: one that is not text.
let WASM = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 255, 254, 128])
let viewer = {
  'package.json': JSON.stringify({ version: '1.0.0', exports: './index.js' }),
  'index.js':
    "export let url = new URL('./decoder.wasm', import.meta.url).href",
  'decoder.wasm': WASM,
}

// What the address a compiled module computed serves, as a host fills its
// package's home: the file, out of the tarball the answer names for it.
let served = async (got: Answer, url: string, get: typeof fetch) => {
  let [, sha, path] = new URL(url).pathname
    .match(/^\/__packages\/([0-9a-f]{64})\/(.+)$/)!
  let tarball = await get(got.tarballs![sha])
  let { sha256, paths, bytes } = await unpacked(tarball.body!, path)
  equal(sha256, sha)
  equal(paths.sort(), Object.keys(viewer).sort())
  return bytes
}

// The answer's files, apart from the compiled modules: no package's file.
let carried = (got: Answer) =>
  Object.keys({ ...got.assets, ...got.shared }).filter((path) =>
    !/\.js$|\/modules\.json$/.test(path)
  )

// A page script's own package, and a shared one.
let beside = async () => {
  let { get } = registry({ viewer: { '1.0.0': viewer } })
  let files = {
    'package.json': JSON.stringify({ dependencies: { viewer: '1.0.0' } }),
    'main.ts': "export { url } from 'viewer'",
  }
  let got = await compile({ files, pages: ['main.ts'] }, {}, undefined, { get })
  equal(got.errors, [])
  equal(carried(got), [])
  let { url } = await run(got.pages['main.ts'])
  equal(await served(got, url, get), WASM)
}

let sharedBeside = async () => {
  let { get } = registry({ viewer: { '1.0.0': viewer } })
  let stage: Catalog = {
    '@yaks/stage': {
      files: {
        'package.json': JSON.stringify({ exports: { '.': './mod.ts' } }),
        'mod.ts': "export { url } from 'viewer'",
      },
      dependencies: { viewer: '*' },
      version: `sha256:${'c'.repeat(64)}`,
    },
  }
  let files = {
    'package.json': JSON.stringify({
      dependencies: { '@yaks/stage': 'platform', viewer: '1.0.0' },
    }),
    'main.ts': "export { url } from 'viewer'\n" +
      "export { url as staged } from '@yaks/stage'",
  }
  let got = await compile({ files, pages: ['main.ts'] }, stage, undefined, {
    get,
  })
  equal(got.errors, [])
  equal(carried(got), [])
  let { url, staged } = await run(got.pages['main.ts'], got.shared)
  equal(staged, url)
  equal(await served(got, url, get), WASM)
}

test('failed installation retains compiler timing', async () => {
  let got = await compile(
    {
      files: { 'package.json': '{' },
      pages: [],
    },
    {},
    undefined,
    { timing: true },
  )
  ok(got.errors.length)
  ok(got.timing!.install > 0)
  ok(got.timing!.total >= got.timing!.install)
  equal(got.timing!.pages, 0)
})
