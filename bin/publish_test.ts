// Publication owns its generated files. Parallel checks and a failed publisher
// must leave the checkout, including edits made during publication, untouched.
import { assertEquals, assertRejects } from '@std/assert'
import { equal, test } from '@yaks/testing'
import { project, shipping } from './publish.ts'

let fixture = async () => {
  let root = await Deno.makeTempDir()
  await Deno.mkdir(`${root}/packages/a/node_modules`, { recursive: true })
  let files = {
    'package.json': { private: true, workspaces: ['packages/*'] },
    'deno.json': { fmt: { semiColons: false } },
    'deno.lock': { version: '5' },
    'packages/a/package.json': {
      name: '@yaks/a',
      version: '1.0.0',
      exports: './mod.ts',
    },
    'packages/a/deno.json': { publish: { exclude: ['*_test.ts'] } },
  }
  for (let [path, value] of Object.entries(files)) {
    await Deno.writeTextFile(
      `${root}/${path}`,
      JSON.stringify(value, null, 2) + '\n',
    )
  }
  await Deno.writeTextFile(`${root}/.gitignore`, 'node_modules\n')
  await Deno.writeTextFile(`${root}/packages/a/mod.ts`, 'export let a = 1\n')
  await Deno.writeTextFile(`${root}/packages/a/node_modules/installed`, 'local')
  return root
}
let concurrent = await fixture()
let failing = await fixture()
let read = (root: string, file: string) => Deno.readTextFile(`${root}/${file}`)
let exists = (path: string) => Deno.stat(path).then(() => true, () => false)

test('parallel publication reads private workspaces and never restores over source edits', async () => {
  let ready = Promise.withResolvers<void>()
  let finished = Promise.withResolvers<void>()
  let manifest = 'packages/a/deno.json'
  let original = await read(concurrent, manifest)
  let first = ''
  let a = project(concurrent, ['packages/a'], async (root) => {
    first = root
    assertEquals(JSON.parse(await read(root, manifest)).name, '@yaks/a')
    assertEquals(await exists(`${root}/packages/a/node_modules`), false)
    assertEquals(await read(concurrent, manifest), original)
    await Deno.writeTextFile(`${root}/packages/a/mod.ts`, 'private')
    await ready.promise
    await Deno.writeTextFile(
      `${concurrent}/${manifest}`,
      'edited during publish',
    )
  }).finally(() => finished.resolve())
  let b = project(concurrent, ['packages/a'], async (root) => {
    try {
      assertEquals(await read(root, 'packages/a/mod.ts'), 'export let a = 1\n')
      assertEquals(JSON.parse(await read(root, 'deno.json')).workspace, [
        './packages/a',
      ])
    } finally {
      ready.resolve()
    }
    await finished.promise
    assertEquals(await exists(first), false)
    assertEquals(await exists(`${root}/${manifest}`), true)
    assertEquals(await read(concurrent, manifest), 'edited during publish')
    return root
  })
  let [, second] = await Promise.all([a, b])
  assertEquals(await exists(second), false)
  assertEquals(
    await read(concurrent, 'packages/a/mod.ts'),
    'export let a = 1\n',
  )
})

test('failed publication removes its workspace and leaves source manifests untouched', async () => {
  let path = ''
  let original = await read(failing, 'packages/a/deno.json')
  await assertRejects(
    () =>
      project(failing, ['packages/a'], (root) => {
        path = root
        return Promise.reject(new Error('publisher failed'))
      }),
    Error,
    'publisher failed',
  )
  assertEquals(await exists(path), false)
  assertEquals(await read(failing, 'packages/a/deno.json'), original)
})

test('a publication ships the subpaths each member publishes', async () => {
  let root = await fixture()
  equal(
    await project(root, ['packages/a'], (at) => shipping(at, ['packages/a'])),
    { '@yaks/a': ['.'] },
  )
})
