import { equal, test } from '@yaks/testing'
import { type Check, check, checks, format } from './test-checks.ts'

let planned = checks(['a.ts', 'doc.md', 'data.json', 'image.png'])

test('source checks format and lint the change', () => {
  equal(planned, [
    {
      name: 'format',
      args: ['fmt', '--permit-no-files', 'a.ts', 'doc.md', 'data.json'],
    },
    { name: 'lint', args: ['lint', '--permit-no-files', 'a.ts'] },
  ])
  equal(checks([]), [])
})

test("a change touching a package checks the whole workspace's public API", () => {
  let publish = (changed: string[]) =>
    checks(changed, ['./packages/a/deno.json', './packages/ab/deno.json'])
      .filter((c) => c.name == 'publish').map((c) => c.args)
  let workspace = [['publish', '--dry-run', '--allow-dirty', '--no-check']]
  equal(publish(['packages/a/a.ts', 'packages/ab/b.ts']), workspace)
  equal(publish(['packages/ab/deno.json']), workspace)
  equal(publish(['workers/yak/a.ts', 'packages/abc/a.ts']), [])
})

let file = Deno.makeTempFileSync({ suffix: '.ts' })
let called: Check[] = []
let files = await format([file, `${file}.deleted`], (c) => {
  called.push(c)
  return Promise.resolve(true)
})
let typed: string[][] = []
let types = (pass: boolean) => (changed: string[]) => {
  typed.push(changed)
  return Promise.resolve(pass)
}
let failed = await check(
  files,
  (c) => {
    called.push(c)
    return Promise.resolve(c.name != 'lint')
  },
  () => Promise.resolve([]),
  types(true),
)
let refused = await check(
  ['packages/a/a.md'],
  (c) => Promise.resolve(!c.name.startsWith('publish')),
  () => Promise.resolve([{ name: '@a/a', config: 'packages/a/deno.json' }]),
  types(true),
)
let untyped = await check(
  ['a.ts'],
  () => Promise.resolve(true),
  () => Promise.resolve([]),
  types(false),
)
Deno.removeSync(file)

test('deleted files are omitted and a lint failure fails the run', () => {
  equal(files, [file])
  equal(called.map((c) => c.name), ['format', 'lint'])
  equal(failed, false)
})

test('a package whose public API is refused fails the run', () => {
  equal(refused, false)
})

test('the types of what the change reaches are checked, and their failure fails the run', () => {
  equal(typed, [[file], ['packages/a/a.md'], ['a.ts']])
  equal(untyped, false)
})
