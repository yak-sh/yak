// What a process runs, proved against another tree, in two small trees.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import * as disk from '@yaks/file/io'
import { imported } from '@yaks/fp/imports'
import { type Code, ENTRY, record, stale } from './code.ts'

// Two trees holding `files`, the second with `edits` over them, and the code
// record of a process running from the first.
let trees = async (
  files: Record<string, string>,
  edits: Record<string, string>,
  code: Partial<Code> = {},
) => {
  let dir = await disk.makeTempDir({ prefix: 'yak-code-' })
  let write = async (root: string, at: Record<string, string>) => {
    for (let [path, text] of Object.entries(at)) {
      await disk.mkdir(disk.dirname(`${root}/${path}`), { recursive: true })
      await disk.writeTextFile(`${root}/${path}`, text)
    }
  }
  await write(`${dir}/0`, files)
  await write(`${dir}/1`, { ...files, ...edits })
  let ran: Code = {
    root: `${dir}/0`,
    tree: 'a',
    imports: [],
    reads: [],
    ...code,
  }
  let why = await stale(ran, { root: `${dir}/1`, id: 'b' })
  await disk.remove(dir, { recursive: true })
  return why
}

let FILES = {
  [ENTRY]: "import './main.ts'\nlet later = () => import('./lazy.ts')",
  'packages/cli/main.ts': 'export let a = 1',
  'packages/cli/lazy.ts': 'export let b = 1',
  'packages/web/views.ts': 'export let c = 1',
  'packages/web/styles.css': 'a {}',
}

test('a process runs what a tree changed only where its graph reaches', async () => {
  assertEquals(await trees(FILES, {}), undefined)
  assertEquals(
    await trees(FILES, { 'packages/web/views.ts': 'export let c = 2' }),
    undefined,
  )
  assertEquals(
    await trees(FILES, { 'packages/cli/main.ts': 'export let a = 2' }),
    'packages/cli/main.ts differs',
  )
  assertEquals(
    await trees(FILES, { 'packages/cli/lazy.ts': 'export let b = 2' }),
    'packages/cli/lazy.ts differs',
  )
  assertEquals(
    await trees(FILES, { 'packages/cli/deno.json': '{}' }),
    'packages/cli/deno.json differs',
  )
})

test('a computed import and a file read are part of what a process runs', async () => {
  let edit = { 'packages/web/views.ts': 'export let c = 2' }
  assertEquals(
    await trees(FILES, edit, { imports: ['packages/web/views.ts'] }),
    'packages/web/views.ts differs',
  )
  assertEquals(
    await trees(FILES, { 'packages/web/styles.css': 'b {}' }, {
      reads: ['packages/web/styles.css'],
    }),
    'packages/web/styles.css differs',
  )
})

test('a supervised process keeps what it imports and reads in its tree, and its config', async () => {
  let dir = await disk.makeTempDir({ prefix: 'yak-code-' })
  let config = `${dir}/yak.json`
  await disk.writeTextFile(config, '{}')
  await disk.mkdir(`${dir}/tree/packages/web`, { recursive: true })
  await disk.writeTextFile(`${dir}/tree/packages/web/styles.css`, 'a {}')
  let file = `${dir}/web.code`
  let tree = { root: `${dir}/tree`, id: 'a' }
  let kept = record(file, config, tree)
  imported([
    `file://${dir}/tree/packages/web/views.ts`,
    `file://${dir}/tree/node_modules/preact/index.js`,
    'jsr:@std/assert',
  ])
  await disk.readTextFile(`${dir}/tree/packages/web/styles.css`)
  let code = kept.now()!
  assertEquals([code.imports, code.reads], [
    ['packages/web/views.ts'],
    ['packages/web/styles.css'],
  ])
  assertEquals(await stale(code, tree), undefined)
  await disk.writeTextFile(config, '{"port": 1}')
  assertEquals(await stale(code, tree), `${config} differs`)
  await kept.stop()
  assertEquals(await disk.stat(file).catch(() => 'gone'), 'gone')
  await disk.remove(dir, { recursive: true })
})
