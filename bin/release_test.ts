// The release cutter's pure seams: what a version is, and what a bump moves.
// The commit and the tag are git, exercised by cutting a release, not here.
import { assertEquals } from '@std/assert'
import { bump, semver } from './release.ts'

Deno.test('semver: three numbers, optionally a prerelease, never a `v`', () => {
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

Deno.test('bump: moves the version and leaves every other byte', () => {
  let json =
    '{\n  "name": "@yaks/query",\n  "version": "0.0.0",\n  "exports": "./mod.ts"\n}\n'
  assertEquals(
    bump(json, '0.1.0'),
    '{\n  "name": "@yaks/query",\n  "version": "0.1.0",\n  "exports": "./mod.ts"\n}\n',
  )
})

Deno.test('bump: only the first version line, so a nested one stays put', () => {
  let json =
    '{\n  "version": "0.0.0",\n  "x": {\n    "version": "9.9.9"\n  }\n}\n'
  assertEquals(
    bump(json, '0.1.0'),
    '{\n  "version": "0.1.0",\n  "x": {\n    "version": "9.9.9"\n  }\n}\n',
  )
})

Deno.test('bump: a config with no version is left alone', () => {
  let json = '{\n  "name": "yak"\n}\n'
  assertEquals(bump(json, '0.1.0'), json)
})
