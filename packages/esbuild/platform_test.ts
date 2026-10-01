import { test } from '@yaks/testing'
import { assertEquals, assertThrows } from '@std/assert'
import { type Catalog, seed, type Toolkit } from './platform.ts'
import { lockfile, pins, reached, wanted } from './lock.ts'
import { satisfies } from 'semver'
import { compile } from './worker.ts'

let digest = (n = 'a') => `sha256:${n.repeat(64)}`
let pkg = (dependencies: Record<string, string> = {}, n = 'a'): Toolkit => ({
  files: {
    'package.json': JSON.stringify({
      exports: { '.': './mod.ts' },
      dependencies,
    }),
    'mod.ts': 'export let n = 1',
  },
  dependencies,
  version: digest(n),
})
let files = (dependencies: Record<string, string>) => ({
  'package.json': JSON.stringify({ name: 'app', dependencies }),
  'main.ts': "import { n } from '@yaks/client'",
})

let catalog: Catalog = {
  '@yaks/client': pkg({ '@yaks/graph': 'platform', preact: '^10' }),
  '@yaks/graph': pkg(
    { '@yaks/client': 'platform', 'is-plain-object': '^5' },
    'b',
  ),
  '@yaks/unused': pkg({ missing: 'latest' }),
}

test('seed closes toolkit dependencies and exposes npm transitives as roots', () => {
  let input = files({ '@yaks/client': 'platform', preact: '^10.20.0' })
  let got = seed(input, catalog)
  assertEquals(got.platform, {
    '@yaks/client': digest(),
    '@yaks/graph': digest('b'),
  })
  assertEquals(Object.keys(got.dependencies).sort(), [
    'is-plain-object',
    'preact',
  ])
  assertEquals(got.dependencies['is-plain-object'], '^5')
  assertEquals(satisfies('10.26.4', got.dependencies.preact), true)
  assertEquals(satisfies('10.19.0', got.dependencies.preact), false)
  assertEquals(satisfies('11.0.0', got.dependencies.preact), false)
  assertEquals(
    got.files['node_modules/@yaks/client/mod.ts'],
    'export let n = 1',
  )
  assertEquals(
    got.files['node_modules/@yaks/graph/package.json'],
    catalog['@yaks/graph'].files['package.json'],
  )
  assertEquals(Object.keys(got.files).some((p) => p.includes('unused')), false)
  assertEquals(Object.keys(input), ['package.json', 'main.ts'])
})

test('seed refuses absent toolkit roots and transitives before npm installation', () => {
  assertThrows(
    () => seed(files({ '@yaks/missing': 'platform' }), catalog),
    Error,
    '@yaks/missing: missing',
  )
  assertThrows(
    () =>
      seed(files({ '@yaks/client': 'platform' }), {
        '@yaks/client': pkg({ '@yaks/missing': 'platform' }),
      }),
    Error,
    '@yaks/missing: missing',
  )
})

test('only compiler-owned toolkit dependencies accept the platform version', () => {
  for (let version of ['0.2.10', '^0.2', 'latest', digest()]) {
    assertThrows(
      () => seed(files({ '@yaks/client': version }), catalog),
      Error,
      '@yaks/client: use "platform"',
    )
  }
  assertThrows(
    () => seed(files({ preact: 'platform' }), catalog),
    Error,
    'only @yaks toolkit packages',
  )
  assertThrows(
    () =>
      seed(files({ '@yaks/client': 'platform' }), {
        '@yaks/client': pkg({ '@yaks/graph': '^0.2' }),
        '@yaks/graph': pkg(),
      }),
    Error,
    '@yaks/graph: use "platform"',
  )
})

test('seed does not load an unused catalog and preserves ordinary npm asks', () => {
  let input = files({ preact: '^10' })
  assertEquals(seed(input, catalog), {
    files: input,
    dependencies: { preact: '^10' },
    platform: {},
  })
  assertEquals(seed({ 'main.ts': 'export {}' }, {}), {
    files: { 'main.ts': 'export {}' },
    dependencies: {},
    platform: {},
  })
})

test('seed refuses incompatible flat npm versions rather than choosing by order', () => {
  assertThrows(
    () => seed(files({ '@yaks/client': 'platform', preact: '^11' }), catalog),
    Error,
    'preact has incompatible versions',
  )
})

test('toolkit locks retain current source provenance and external package pins', () => {
  let ranges = { '@yaks/client': 'platform' }
  let old = lockfile('app', ranges, {
    '@yaks/client': digest('c'),
    '@yaks/retired': '0.2.10',
    preact: '10.26.4',
    'is-plain-object': '5.0.0',
  })
  let setup = seed(files(ranges), catalog)
  let want = wanted(setup.dependencies, pins(old))
  assertEquals(want, { preact: '10.26.4', 'is-plain-object': '5.0.0' })
  // The installer reports only npm packages; seed contributes toolkit digests.
  let installed = { ...want, ...setup.platform }
  let kept = reached(
    Object.keys(ranges),
    installed,
    (name) => Object.keys(catalog[name]?.dependencies ?? {}),
  )
  let next = JSON.parse(lockfile('app', ranges, kept))
  assertEquals(next.packages['node_modules/@yaks/client'], {
    version: digest(),
    resolved: 'platform',
  })
  assertEquals(next.packages['node_modules/@yaks/graph'].version, digest('b'))
  assertEquals(next.packages['node_modules/preact'].version, '10.26.4')
  assertEquals(next.packages['node_modules/@yaks/retired'], undefined)
})

test('compile answers toolkit declaration errors before calling the installer', async () => {
  let missing = await compile({
    files: files({ '@yaks/missing': 'platform' }),
    pages: [],
  }, catalog)
  assertEquals(
    missing.errors.some((e) => e.includes('@yaks/missing: missing')),
    true,
  )
  assertEquals(missing.installed, [])
  assertEquals(missing.lock, undefined)
  let wrong = await compile({
    files: files({ '@yaks/client': '^0.2' }),
    pages: [],
  }, catalog)
  assertEquals(wrong.errors.some((e) => e.includes('use "platform"')), true)
})

test('compile without entries records toolkit provenance without npm I/O', async () => {
  let got = await compile({
    files: files({ '@yaks/client': 'platform' }),
    pages: [],
  }, { '@yaks/client': pkg() })
  assertEquals(got.errors, [])
  assertEquals(got.installed, [`@yaks/client@${digest()}`])
  assertEquals(JSON.parse(got.lock!).packages['node_modules/@yaks/client'], {
    version: digest(),
    resolved: 'platform',
  })
  assertEquals((await compile({ files: {}, pages: [] })).errors, [])
})
