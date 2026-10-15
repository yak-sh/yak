import { test } from '@yaks/testing'
import { assertEquals, assertNotEquals } from '@std/assert'
import { Files } from './npm.ts'
import { type Catalog, seed } from './platform.ts'
import { shared } from './shared.ts'
import { stop } from './bundle.ts'

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

test('shared analysis follows edits, new resolution targets and changed package sources', async () => {
  let fs = make()
  let build = () =>
    shared(fs, setup, catalog, 'https://analysis.test', ['main.js'])
  try {
    let first = await build()
    assertEquals(await build(), first)
    // The same Files object is mutable: neither its identity nor a toolkit
    // version is proof that the imports or selected exports stayed the same.
    fs.write(
      'main.js',
      "export { b } from 'analysis-fixture'; import './later.js'",
    )
    let edited = await build()
    assertNotEquals(
      edited.urls['analysis-fixture'],
      first.urls['analysis-fixture'],
    )
    fs.write('main.js', files['main.js'])
    assertEquals(await build(), first)
    // A previously missing resolution target must be among validated reads.
    fs.write('later.js', "import { b } from 'analysis-fixture'; console.log(b)")
    let added = await build()
    assertNotEquals(
      added.urls['analysis-fixture'],
      first.urls['analysis-fixture'],
    )
    fs.delete('later.js')
    assertEquals(await build(), first)
    fs.write(
      'node_modules/analysis-fixture/index.js',
      'export let a = 303; export let b = 404',
    )
    assertNotEquals(
      (await build()).urls['analysis-fixture'],
      first.urls['analysis-fixture'],
    )
    // Fresh Files at the same manifest identity must not inherit those edits.
    fs = make()
    assertEquals(await build(), first)
  } finally {
    await stop()
  }
})
