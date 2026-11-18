import { test } from '@yaks/testing'
import { assertEquals, assertThrows } from '@std/assert'
import { type Config, mergeConfigs, platformConfig } from './check-platform.ts'

let config = (imports = {}, lib = ['dom', 'es2023']): Config => ({
  compilerOptions: { lib, strict: true },
  imports,
})
let a = new URL('file:///repo/packages/a/browser.json')
let b = new URL('file:///repo/packages/b/browser.json')

test('platform maps resolve at their own config, then share one program', () => {
  assertEquals(
    mergeConfigs([
      { url: a, config: config({ '@yaks/a': './mod.ts' }) },
      {
        url: b,
        config: config({
          '@yaks/a': '../a/mod.ts',
          external: 'jsr:@example/package@1',
        }, ['dom', 'dom.asynciterable', 'es2023']),
      },
    ]),
    {
      nodeModulesDir: 'manual',
      compilerOptions: {
        strict: true,
        lib: ['dom', 'dom.asynciterable', 'es2023'],
      },
      imports: {
        '@yaks/a': 'file:///repo/packages/a/mod.ts',
        external: 'jsr:@example/package@1',
      },
    },
  )
})

test('package resources coexist with the platform type-checking program', () => {
  assertEquals(
    mergeConfigs([
      { url: a, config: { ...config(), resources: ['**/*.css'] } },
      { url: b, config: config() },
    ]),
    mergeConfigs([{ url: a, config: config() }]),
  )
})

test('platform merging refuses conflicts, hidden options and runtime libs', () => {
  assertThrows(() => mergeConfigs([]), Error, 'No platform configs')
  assertThrows(
    () =>
      mergeConfigs([
        { url: a, config: config({ x: './mod.ts' }) },
        { url: b, config: config({ x: './mod.ts' }) },
      ]),
    Error,
    'conflicting platform import x',
  )
  assertThrows(
    () =>
      mergeConfigs([
        { url: a, config: config() },
        {
          url: b,
          config: { compilerOptions: { lib: ['dom'], strict: false } },
        },
      ]),
    Error,
    'incompatible platform compiler options',
  )
  assertThrows(
    () =>
      mergeConfigs([
        { url: a, config: { ...config(), scopes: {} } },
      ]),
    Error,
    'unsupported platform config field scopes',
  )
  assertThrows(
    () =>
      mergeConfigs([
        { url: a, config: config({}, ['deno.ns']) },
      ]),
    Error,
    'non-web platform lib deno.ns',
  )
  // A page meets browsers that lack what ES2023 does not have; workerd has
  // it, and no DOM.
  let esnext = [{ url: a, config: config({}, ['esnext']) }]
  assertThrows(() => mergeConfigs(esnext), Error, 'platform lib esnext')
  assertEquals(mergeConfigs(esnext, 'workers').compilerOptions.lib, ['esnext'])
  assertThrows(
    () => mergeConfigs([{ url: a, config: config() }], 'workers'),
    Error,
    'platform lib dom',
  )
})

let fixture = Deno.makeTempDirSync({ prefix: 'yaks-platform-' })
let files: Record<string, unknown> = {
  'packages/a/browser.json': config(),
  'packages/a/package.json': {
    exports: {
      '.': './mod.ts',
      './vocab': './vocab.ts',
      './views': './views.ts',
    },
  },
  'packages/a/workers.json': {
    ...config({}, ['esnext']),
    nodeModules: ['node:async_hooks'],
  },
  'workers/edge/workers.json': {
    ...config({}, ['esnext']),
    entries: ['conform.ts', 'index.ts'],
    nodeModules: ['node:crypto'],
    hostOnly: ['host.ts'],
  },
  'workers/edge/front/workers.json': {
    ...config({}, ['esnext']),
    entries: ['index.ts'],
  },
  'workers/edge/public/copied/workers.json': {
    compilerOptions: { lib: ['invalid'] },
  },
}
for (let [path, contents] of Object.entries(files)) {
  let target = `${fixture}/${path}`
  Deno.mkdirSync(target.replace(/\/[^/]+$/, ''), { recursive: true })
  Deno.writeTextFileSync(target, JSON.stringify(contents))
}
let root = new URL(`file://${fixture}/`)
let browser = await platformConfig(root, 'browser')
let workers = await platformConfig(root, 'workers')
Deno.removeSync(fixture, { recursive: true })

test('platform entrypoints cover browser facets and nested shipped Workers with separate capabilities', () => {
  assertEquals(
    browser.entries,
    ['packages/a/mod.ts', 'packages/a/views.ts', 'packages/a/vocab.ts'].map((
      p,
    ) => new URL(p, root).href),
  )
  assertEquals(
    workers.entries,
    [
      'packages/a/conform.ts',
      'workers/edge/conform.ts',
      'workers/edge/front/index.ts',
      'workers/edge/index.ts',
    ].map((p) => new URL(p, root).href),
  )
  let capabilities = Object.fromEntries(
    workers.boundaries.flatMap((boundary) =>
      boundary.entries.map((
        entry,
      ) => [entry.slice(root.href.length), {
        nodeModules: boundary.nodeModules,
        hostOnly: boundary.hostOnly,
      }])
    ),
  )
  assertEquals(capabilities['packages/a/conform.ts'], {
    nodeModules: ['node:async_hooks'],
    hostOnly: [],
  })
  assertEquals(capabilities['workers/edge/index.ts'], {
    nodeModules: ['node:crypto'],
    hostOnly: [new URL('workers/edge/host.ts', root).href],
  })
  assertEquals(capabilities['workers/edge/front/index.ts'], {
    nodeModules: [],
    hostOnly: [],
  })
  assertEquals(browser.config.imports?.['@cloudflare/workers-types'], undefined)
})
