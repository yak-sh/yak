import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { gzipSync } from 'fflate'
import { Files, install } from './npm.ts'

let encode = (text: string) => new TextEncoder().encode(text)

// A gzipped tarball of these files under `package/`, the way npm packs one.
let tgz = (files: Record<string, string | Uint8Array>) => {
  let blocks: Uint8Array[] = []
  for (let [path, content] of Object.entries(files)) {
    let body = typeof content == 'string' ? encode(content) : content
    let head = new Uint8Array(512)
    head.set(encode(`package/${path}`))
    head.set(encode(body.length.toString(8).padStart(11, '0')), 124)
    head[156] = 48
    head.set(encode('ustar\x0000'), 257)
    blocks.push(head, body, new Uint8Array((512 - body.length % 512) % 512))
  }
  blocks.push(new Uint8Array(1024))
  let tar = new Uint8Array(blocks.reduce((n, b) => n + b.length, 0))
  blocks.reduce((at, b) => (tar.set(b, at), at + b.length), 0)
  return gzipSync(tar)
}

// A registry of these packages, name to version to its files, answering what
// it was asked in `asked`.
let registry = (
  packages: Record<string, Record<string, Record<string, string | Uint8Array>>>,
) => {
  let asked: string[] = []
  let answer = (url: string) => {
    let path = decodeURIComponent(new URL(url).pathname.slice(1))
    asked.push(path)
    let [, name, version] = path.match(/^(.+)\/-\/(.+)\.tgz$/) ?? [, path]
    let releases = packages[name!]
    if (!releases) return new Response('', { status: 404 })
    if (version) return new Response(tgz(releases[version]))
    let versions = Object.fromEntries(
      Object.entries(releases).map(([v, files]) => [v, {
        dependencies: JSON.parse(String(files['package.json'])).dependencies,
        dist: { tarball: `https://registry.test/${name}/-/${v}.tgz` },
      }]),
    )
    let latest = Object.keys(versions).at(-1)
    return Response.json({ 'dist-tags': { latest }, versions })
  }
  let get = ((url: string) => Promise.resolve(answer(url))) as typeof fetch
  return { get, asked }
}

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
