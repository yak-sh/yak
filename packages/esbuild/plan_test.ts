import { assertEquals, assertRejects } from '@std/assert'
import { plan, Unplanned } from './plan.ts'
import { modules, sources } from './graph.ts'

let bytes = (text: string) => new TextEncoder().encode(text)

// An app of these files, its worker at `main` when it has one.
let app = (files: Record<string, string>, main?: string) => ({
  paths: Object.keys(files),
  read: (path: string) =>
    Promise.resolve(path in files ? bytes(files[path]) : null),
  main,
  flags: ['nodejs_compat'],
})

// What a deploy of these files compiles: the worker's entry, the page
// scripts, and the files sent; null when nothing is compiled.
let planned = async (files: Record<string, string>, main?: string) => {
  let p = await plan(app(files, main))
  return p && {
    worker: p.ask.worker?.entry ?? null,
    carry: p.ask.worker?.carry ?? [],
    pages: p.ask.pages,
    sent: Object.keys(p.ask.files).sort(),
    notes: p.notes,
  }
}

let PAGE = (src: string) =>
  `<!doctype html><script type="module" src="${src}"></script>`
let THREE = JSON.stringify({ dependencies: { three: '^0.180.0' } })

Deno.test('an app of plain modules compiles nothing', async () => {
  assertEquals(
    await planned({
      'index.html': PAGE('app.js'),
      'app.js':
        `import { draw } from './draw.js'\nimport x from './api/client.js'`,
      'draw.js': 'export let draw = () => {}',
      'worker.js': `import { DurableObject } from 'cloudflare:workers'\n` +
        `import fs from 'node:fs'\nexport default {}`,
    }, 'worker.js'),
    null,
  )
})

Deno.test('a TypeScript worker compiles, with the files it reaches', async () => {
  assertEquals(
    await planned({
      'worker.ts':
        `import { route } from './route'\nexport default { fetch: route }`,
      'route.ts':
        `import rows from './rows.txt'\nimport add from '../add.wasm'\n` +
        `import cfg from './cfg.json'\nexport let route = () => rows`,
      'rows.txt': 'a\nb',
      'add.wasm': '\0asm',
      'cfg.json': '{}',
      'index.html': '<h1>hi</h1>',
    }, 'worker.ts'),
    {
      worker: 'worker.ts',
      // What esbuild does not read goes up beside the compiled module.
      carry: ['rows.txt', 'add.wasm'],
      pages: [],
      sent: ['cfg.json', 'route.ts', 'worker.ts'],
      notes: [],
    },
  )
})

Deno.test('a JavaScript worker that imports a package compiles', async () => {
  let got = await planned({
    'worker.js': `import { Hono } from 'hono'\nexport default new Hono()`,
    'package.json': JSON.stringify({ dependencies: { hono: '^4' } }),
    'package-lock.json': '{}',
  }, 'worker.js')
  assertEquals(got?.worker, 'worker.js')
  assertEquals(got?.sent, ['package-lock.json', 'package.json', 'worker.js'])
})

Deno.test('a page script compiles when it is TypeScript or imports a declared package', async () => {
  let got = await planned({
    'index.html': PAGE('main.ts') + PAGE('./game/app.js?v=2') +
      PAGE('plain.js'),
    'main.ts': `let n: number = 1\nexport {}`,
    'game/app.js': `import * as THREE from 'three'\nimport { ui } from './ui'`,
    'game/ui.jsx': `import { h } from './h.js'\nexport let ui = <b>it's</b>`,
    'game/h.js': `// import './said.js'\nexport let h = 1`,
    'game/said.js': '',
    'plain.js': `import { apply } from './api/client.js'`,
    'package.json': THREE,
  })
  assertEquals(got?.worker, null)
  assertEquals(got?.pages, ['main.ts', 'game/app.js'])
  assertEquals(got?.sent, [
    'game/app.js',
    'game/h.js',
    'game/ui.jsx',
    'main.ts',
    'package.json',
  ])
})

Deno.test('a compiled page notes each package no import map on its pages resolves', async () => {
  let MAP = `<script type=importmap>{"imports": {"@yaks/client": ` +
    `"https://esm.sh/jsr/@yaks/client", "lit/": "https://esm.sh/lit/"}}` +
    '</script>'
  let noted = async (pages: Record<string, string>) =>
    (await planned({
      ...pages,
      'main.ts': "/** ```ts\n * import { assert } from '@std/assert'\n" +
        " * ``` */\nimport type { T } from 'types'\n" +
        `import { c } from '@yaks/client'\nimport 'lit/decorators.js'\n` +
        `import * as THREE from 'three'`,
    }))?.notes.map((n) => n.split(/[ ,]/)[2])
  assertEquals(await noted({ 'index.html': MAP + PAGE('main.ts') }), [
    'three',
  ])
  // A page without the map loads the same script, and the browser cannot
  // resolve it there.
  assertEquals(
    await noted({
      'index.html': MAP + PAGE('main.ts'),
      'b.html': PAGE('main.ts'),
    }),
    ['@yaks/client', 'lit/decorators.js', 'three'],
  )
})

Deno.test('a package package.json does not name is left to an import map', async () => {
  // Nothing to compile: the page imports it by name, and says where in HTML.
  assertEquals(
    await planned({
      'index.html': `<script type="importmap">{"imports": {"three": ` +
        `"https://esm.sh/three"}}</script>` + PAGE('app.js'),
      'app.js': `import * as THREE from 'three'`,
    }),
    null,
  )
  // A page compiled anyway says which import it left alone, and a CSS import
  // it cannot keep.
  let got = await planned({
    'index.html': PAGE('app.ts'),
    'app.ts': `import * as THREE from 'three'\nimport './app.css'`,
    'app.css': 'b {}',
  })
  assertEquals(got?.notes.length, 2)
  assertEquals(got?.notes[0].startsWith('app.ts imports three'), true)
  assertEquals(got?.notes[1].startsWith('app.ts imports app.css'), true)
})

Deno.test('a package.json that says nothing readable refuses in a sentence', async () => {
  for (let pkg of ['{"dependencies": ', '{"dependencies": ["three"]}']) {
    await assertRejects(
      () => plan(app({ 'package.json': pkg, 'worker.ts': '' }, 'worker.ts')),
      Unplanned,
      'package.json',
    )
  }
})

Deno.test('the runtime reads a specifier exactly, esbuild tries the extensions', async () => {
  let files = app({
    'worker.js': `import './lib'\nimport './dir'\nimport './w.js'`,
    'lib.ts': '',
    'dir/index.js': '',
    'w.js': `import '../w.js'`,
  })
  assertEquals([...(await modules(files.read, 'worker.js')).files.keys()], [
    'worker.js',
    'w.js',
  ])
  assertEquals([...(await sources(files.read, 'worker.js')).files.keys()], [
    'worker.js',
    'lib.ts',
    'dir/index.js',
    'w.js',
  ])
})
