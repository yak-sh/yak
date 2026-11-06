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

let pages: typeof fetch = (url) =>
  Promise.resolve(
    String(url).endsWith('/packages/old')
      ? Response.json({ description: '', runtimeCompat: {} })
      : new Response(null, { status: 404 }),
  )
test('unlisted: a package named that jsr.io has no page for', async () => {
  assertEquals(await unlisted(['@yaks/new', '@yaks/old'], pages), ['@yaks/new'])
})

test('versioned: each member and internal dependency at its own version, external ranges kept', () => {
  let before = {
    name: '@yaks/a',
    version: '1.0.0',
    dependencies: { '@yaks/b': '1.0.0', '@yaks/c': '1.0.0', yaml: '^2' },
  }
  let next = new Map([['@yaks/a', '1.1.0'], ['@yaks/b', '1.1.0']])
  assertEquals(versioned(before, next), {
    name: '@yaks/a',
    version: '1.1.0',
    dependencies: { '@yaks/b': '1.1.0', '@yaks/c': '1.0.0', yaml: '^2' },
  })
  assertEquals(versioned({ name: '@yaks/c', version: '1.0.0' }, next), {
    name: '@yaks/c',
    version: '1.0.0',
  })
  assertEquals(before.version, '1.0.0')
})
