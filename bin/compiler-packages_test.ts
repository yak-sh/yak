// Catalog behavior over a scratch workspace: manifests own names, imports and
// browser exports, and captured source bytes own the compiler's provenance.
import { assertEquals, assertMatch, assertRejects } from '@std/assert'
import { test } from '@yaks/testing'
import { catalog, write } from './compiler-packages.ts'

let scratch = async (
  files: Record<string, string>,
  run: (root: string) => Promise<void>,
) => {
  let root = await Deno.makeTempDir({ prefix: 'compiler-packages-' })
  try {
    for (let [path, text] of Object.entries(files)) {
      let at = `${root}/${path}`
      await Deno.mkdir(at.slice(0, at.lastIndexOf('/')), { recursive: true })
      await Deno.writeTextFile(at, text)
    }
    await run(root)
  } finally {
    await Deno.remove(root, { recursive: true })
  }
}

let json = JSON.stringify
let workspace = () => ({
  'deno.json': json({
    workspace: ['./packages/a', './packages/b', './apps/demo'],
    imports: { preact: 'npm:preact@^10.29.1' },
  }),
  'packages/a/deno.json': json({
    name: '@yaks/a',
    exports: {
      '.': './mod.tsx',
      './server': './server.ts',
      './style': './base.css',
    },
    imports: {
      alias: 'npm:tiny@2.0.0/sub',
      preact: 'npm:preact@10.29.2',
      'preact/hooks': 'npm:preact@10.29.2/hooks',
      '@std/assert': 'jsr:@std/assert@^1',
    },
  }),
  'packages/a/browser.json': '{}',
  'packages/a/mod.tsx': `
    /** import nope from '@std/assert' */
    import type { Nope } from '@yaks/missing'
    import { hook } from 'preact/hooks'
    import { value } from '@yaks/b/item'
    import obj from './value.json' with { type: 'json' }
    import './base.css'
    export { extra } from './extra.ts'
    export let load = () => import('alias')
    export let view = <span>{hook(value + obj.n)}</span>
  `,
  'packages/a/extra.ts': 'export let extra: number = 3',
  'packages/a/value.json': '{"n": 4}',
  'packages/a/base.css': '.Base { color: red }',
  'packages/a/server.ts': "import './fixtures/missing.ts'",
  'packages/a/fixtures/unused.ts': 'ignored',
  'packages/a/unused_test.ts': 'ignored',
  'packages/b/deno.json': json({
    name: '@yaks/b',
    exports: { '.': './server.ts', './item': './item.ts' },
  }),
  'packages/b/item.ts': 'export let value: number = 5',
  'packages/b/server.ts': "import 'node:fs'",
  'apps/demo/deno.json': json({ name: '@demo/app', exports: './main.ts' }),
  'apps/demo/main.ts': "import 'broken-app-import'",
})

test('compiler catalog captures runtime source closure and npm-shaped exports', async () => {
  await scratch(workspace(), async (root) => {
    let out = await catalog(root)
    assertEquals(Object.keys(out), ['@yaks/a', '@yaks/b'])
    assertEquals(out['@yaks/a'].dependencies, {
      '@yaks/b': 'platform',
      preact: '10.29.2',
      tiny: '2.0.0',
    })
    assertEquals(Object.keys(out['@yaks/b'].files), ['item.ts', 'package.json'])
    assertEquals(
      json(JSON.parse(out['@yaks/a'].files['package.json']).exports),
      json({ '.': './mod.tsx', './style': './base.css' }),
    )
    let source = out['@yaks/a'].files['mod.tsx']
    assertMatch(source, /from ["']preact\/jsx-runtime["']/)
    assertMatch(source, /from ["']preact\/hooks["']/)
    assertMatch(source, /from ["']@yaks\/b\/item["']/)
    assertMatch(source, /import\(["']tiny\/sub["']\)/)
    assertMatch(source, /with \{ type: ['"]json['"] \}/)
    assertEquals(out['@yaks/a'].files['base.css'], '.Base { color: red }')
    assertMatch(out['@yaks/a'].version, /^sha256:[a-f0-9]{64}$/)
  })
})

test('compiler catalog is stable, content-addressed and materialized atomically', async () => {
  await scratch(workspace(), async (root) => {
    let a = await catalog(root)
    assertEquals(await catalog(root), a)
    await Deno.writeTextFile(
      `${root}/packages/a/extra.ts`,
      'export let extra = 4',
    )
    let b = await write(root, `${root}/.wrangler/packages.json`)
    assertEquals(b['@yaks/a'].version == a['@yaks/a'].version, false)
    assertEquals(b['@yaks/b'].version, a['@yaks/b'].version)
    assertEquals(
      JSON.parse(await Deno.readTextFile(`${root}/.wrangler/packages.json`)),
      b,
    )
    assertEquals(
      [...Deno.readDirSync(`${root}/.wrangler`)].map((f) => f.name),
      ['packages.json'],
    )
  })
})

test('compiler catalog normalizes relative import-map aliases', async () => {
  let files = workspace()
  files['packages/a/mod.tsx'] =
    "import { extra } from 'helper'; export { extra }"
  files['packages/a/deno.json'] = json({
    name: '@yaks/a',
    exports: './mod.tsx',
    imports: { helper: './extra.ts' },
  })
  await scratch(files, async (root) => {
    let out = await catalog(root)
    assertMatch(out['@yaks/a'].files['mod.tsx'], /from ['"]\.\/extra.ts['"]/)
    assertEquals(out['@yaks/a'].dependencies, {})
  })
})

test('compiler catalog refuses unknown exports and excluded source paths', async () => {
  for (
    let spec of ['@yaks/b/missing', './fixtures/unused.ts', '../../outside.ts']
  ) {
    let files = workspace()
    files['packages/a/mod.tsx'] = `import '${spec}'`
    await scratch(files, async (root) => {
      await assertRejects(() => catalog(root), Error)
    })
  }
})

test('browser catalog captures declared resource globs and their digests', async () => {
  let files = workspace()
  files['packages/a/browser.json'] = json({
    entries: ['.'],
    resources: ['**/*.css'],
  })
  files['packages/a/parts/Button.css'] = '.Button {}'
  files['packages/a/theme.css'] = ':root { --color: red }'
  files['packages/a/fixtures/unused.css'] = 'unused'
  files['packages/a/private.txt'] = 'private'
  await scratch(files, async (root) => {
    let a = await catalog(root)
    assertEquals(a['@yaks/a'].resources, {
      'base.css': '.Base { color: red }',
      'parts/Button.css': '.Button {}',
      'theme.css': ':root { --color: red }',
    })
    await Deno.writeTextFile(`${root}/packages/a/theme.css`, ':root {}')
    let b = await catalog(root)
    assertEquals(b['@yaks/a'].version == a['@yaks/a'].version, false)
    assertEquals(b['@yaks/b'].version, a['@yaks/b'].version)
  })
})
