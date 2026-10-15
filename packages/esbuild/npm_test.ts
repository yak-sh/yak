import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { Files, install } from './npm.ts'
import { registry } from './registry_fixture_test.ts'

let manifest = (dependencies: Record<string, string> = {}) =>
  JSON.stringify({ dependencies })

let PNG = new Uint8Array([137, 80, 78, 71])

test('an install resolves each range flat, and a build reads the files it asks for', async () => {
  let { get } = registry({
    game: {
      '1.0.0': { 'package.json': manifest(), 'index.js': 'old' },
      '1.2.0': {
        'package.json': manifest({ '@kit/math': '^2' }),
        'index.js': 'export let game = 1',
        'docs/README.md': '# game',
        'logo.png': PNG,
      },
      '2.0.0': { 'package.json': manifest(), 'index.js': 'next' },
    },
    '@kit/math': { '2.1.0': { 'package.json': manifest(), 'add.js': '1+1' } },
  })
  let fs = new Files({ 'main.ts': 'import "game"' })
  let got = await install(fs, { game: '^1' }, get, 'https://registry.test')
  assertEquals(got, {
    installed: ['game@1.2.0', '@kit/math@2.1.0'],
    warnings: [],
  })
  assertEquals(fs.read('node_modules/game/index.js'), 'export let game = 1')
  assertEquals(fs.read('node_modules/@kit/math/add.js'), '1+1')
  assertEquals(fs.read('node_modules/game/docs/README.md'), '# game')
  // What a build cannot read (an image), or what the package lacks, is not
  // there.
  assertEquals(fs.read('node_modules/game/logo.png'), null)
  assertEquals(fs.read('node_modules/game/index.ts'), null)
  assertEquals(fs.read('main.ts'), 'import "game"')
  assertEquals(fs.list('node_modules/game/').sort(), [
    'node_modules/game/docs/README.md',
    'node_modules/game/index.js',
    'node_modules/game/package.json',
  ])
})

test('a package the files already hold is not fetched', async () => {
  let { get, asked } = registry({
    game: { '1.0.0': { 'package.json': manifest({ kit: '^1' }), 'a.js': '' } },
  })
  let fs = new Files({ 'node_modules/kit/package.json': manifest() })
  let got = await install(
    fs,
    { game: '1.0.0', kit: '^1' },
    get,
    'https://registry.test',
  )
  assertEquals(got.installed, ['game@1.0.0'])
  assertEquals(asked, ['game', 'game/-/1.0.0.tgz'])
})

test('what cannot be installed is said, package by package', async () => {
  let { get } = registry({
    game: { '1.0.0': { 'package.json': manifest(), 'a.js': '' } },
  })
  let got = await install(
    new Files(),
    { game: '^3', ghost: '^1' },
    get,
    'https://registry.test',
  )
  assertEquals(got.installed, [])
  assertEquals(got.warnings.sort(), [
    'could not install ghost: the registry answered 404 for "ghost" (no ' +
    'such package: check its name in package.json)',
    'no version of game satisfies ^3',
  ])
})
