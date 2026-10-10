import { test } from '@yaks/testing'
import { createHash } from 'node:crypto'
import { assertEquals } from '@std/assert'
import { type Lock, matching, restored, stale } from './dependencies.ts'

let pkg = { version: '1', integrity: 'sha512-one' }
let packages = {
  '': { name: 'yak' },
  'node_modules/dep': pkg,
  'node_modules/other-platform': { version: '1', optional: true },
}
let lock = (packages: unknown): Lock =>
  ({ lockfileVersion: 3, packages }) as Lock

test('npm cache reuse follows package contents, including omitted optional packages', () => {
  let wanted = lock(packages)
  for (
    let [held, want] of [
      [{ 'node_modules/dep': pkg }, true],
      [
        { 'node_modules/dep': { integrity: pkg.integrity, version: '1' } },
        true,
      ],
      [{ 'node_modules/dep': { ...pkg, version: '2' } }, false],
      [{ 'node_modules/dep': { ...pkg, integrity: 'sha512-two' } }, false],
      [{}, false],
      [{ 'node_modules/dep': pkg, 'node_modules/extra': pkg }, false],
    ] as [unknown, boolean][]
  ) assertEquals(matching(wanted, lock(held)), want)
})

test('npm cache reuse survives a fresh checkout and rejects missing packages', () => {
  let root = Deno.makeTempDirSync()
  let stamp = `${root}/node_modules/.package-lock.json`
  try {
    Deno.writeTextFileSync(
      `${root}/package-lock.json`,
      JSON.stringify(lock(packages)),
    )
    assertEquals(stale(root), true, 'empty cache')
    Deno.mkdirSync(`${root}/node_modules/dep`, { recursive: true })
    Deno.writeTextFileSync(
      stamp,
      JSON.stringify(lock({ 'node_modules/dep': pkg })),
    )
    Deno.utimeSync(stamp, 0, 0)
    assertEquals(stale(root), false, 'same install before a fresh checkout')
    Deno.removeSync(`${root}/node_modules/dep`)
    assertEquals(stale(root), true, 'stamp outlived a missing package')
  } finally {
    Deno.removeSync(root, { recursive: true })
  }
})

test('a restored npm cache supplies a fresh checkout without installing', async () => {
  let root = Deno.makeTempDirSync(), cache = `${root}/cache`
  let files = [
    ['package.json', '{"private":true}'],
    ['package-lock.json', JSON.stringify(lock(packages))],
  ]
  let key = createHash('sha256').update(
    JSON.stringify([Deno.build.os, Deno.build.arch, files]),
  ).digest('hex')
  let project = `${cache}/yak-installed/${key}`
  try {
    Deno.mkdirSync(`${project}/node_modules/dep`, { recursive: true })
    Deno.writeTextFileSync(
      `${project}/node_modules/.package-lock.json`,
      JSON.stringify(lock({ 'node_modules/dep': pkg })),
    )
    for (let [name, contents] of files) {
      Deno.writeTextFileSync(`${root}/${name}`, contents)
    }
    assertEquals(await restored(cache, root), false)
    assertEquals(stale(root), false)
  } finally {
    Deno.removeSync(root, { recursive: true })
  }
})
