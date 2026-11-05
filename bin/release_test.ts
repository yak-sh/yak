// The release cutter's pure seams: what a version is, and what a bump moves.
// The commit and the tag are git, exercised by cutting a release, not here.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { bump, semver, unlisted, versioned } from './release.ts'

test('semver: three numbers, optionally a prerelease, never a `v`', () => {
  assertEquals([semver('0.1.0'), semver('1.0.0'), semver('0.1.0-rc.1')], [
    true,
    true,
    true,
  ])
  assertEquals(
    [semver('v0.1.0'), semver('0.1'), semver(''), semver('latest')],
    [
      false,
      false,
      false,
      false,
    ],
  )
})

test('bump: moves the version and leaves every other byte', () => {
  let json =
    '{\n  "name": "@yaks/query",\n  "version": "0.0.0",\n  "exports": "./mod.ts"\n}\n'
  assertEquals(
    bump(json, '0.1.0'),
    '{\n  "name": "@yaks/query",\n  "version": "0.1.0",\n  "exports": "./mod.ts"\n}\n',
  )
})

test('bump: only the first version line, so a nested one stays put', () => {
  let json =
    '{\n  "version": "0.0.0",\n  "x": {\n    "version": "9.9.9"\n  }\n}\n'
  assertEquals(
    bump(json, '0.1.0'),
    '{\n  "version": "0.1.0",\n  "x": {\n    "version": "9.9.9"\n  }\n}\n',
  )
})

test('bump: a config with no version is left alone', () => {
  let json = '{\n  "name": "yak"\n}\n'
  assertEquals(bump(json, '0.1.0'), json)
})

// Build the workspace once; the assertion still reads which members publish.
let root = await Deno.makeTempDir()
let member = async (dir: string, config: Record<string, unknown>) => {
  await Deno.mkdir(`${root}/${dir}`)
  await Deno.writeTextFile(`${root}/${dir}/deno.json`, JSON.stringify(config))
  await Deno.writeTextFile(
    `${root}/${dir}/package.json`,
    JSON.stringify(config),
  )
}
await Deno.writeTextFile(
  `${root}/package.json`,
  JSON.stringify({ workspaces: ['./new', './old', './kept', './npm'] }),
)
await member('new', { name: '@yaks/new' })
await member('old', { name: '@yaks/old' })
await member('kept', { name: '@yaks/kept', publish: false })
await member('npm', {})
let pages: typeof fetch = (url) =>
  Promise.resolve(
    String(url).endsWith('/packages/old')
      ? Response.json({ description: '', runtimeCompat: {} })
      : new Response(null, { status: 404 }),
  )
let missing = await unlisted(root, pages)
await Deno.remove(root, { recursive: true })
test('unlisted: a package it would publish that jsr.io has no page for', () => {
  assertEquals(missing, ['@yaks/new'])
})

test('family versions update internal dependencies without changing external ranges', () => {
  let before = {
    name: '@yaks/a',
    version: '1.0.0',
    dependencies: { '@yaks/b': '1.0.0', yaml: '^2' },
  }
  assertEquals(versioned(before, '1.1.0', new Set(['@yaks/a', '@yaks/b'])), {
    name: '@yaks/a',
    version: '1.1.0',
    dependencies: { '@yaks/b': '1.1.0', yaml: '^2' },
  })
  assertEquals(before.version, '1.0.0')
})
