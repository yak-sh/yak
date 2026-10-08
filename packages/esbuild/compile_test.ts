import { equal, match, test } from '@yaks/testing'
import { parse } from 'es-module-lexer/js'
import { bundle, Stopped } from './bundle.ts'
import compiler, { compile, type Job } from './compile.ts'
import type { Answer, Ask } from './plan.ts'
import type { Catalog } from './platform.ts'

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
let run = (code: string) =>
  import(`data:text/javascript,${encodeURIComponent(code)}`)

test('the server compiles a posted job into one module per page', async () => {
  let job: Job = {
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
  equal(imports(got.pages['main.ts']), [])
  equal((await run(got.pages['main.ts'])).out, '2production')
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
