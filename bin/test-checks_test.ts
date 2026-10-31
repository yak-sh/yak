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

test('a change checks the public API of the packages it touches', () => {
  let names = (changed: string[]) =>
    checks(changed, ['./packages/a/deno.json', './packages/ab/deno.json'])
      .filter((c) => c.name.startsWith('publish')).map((c) => c.args.at(-1))
  equal(names(['packages/a/a.ts', 'packages/a/b.ts']), [
    './packages/a/deno.json',
  ])
  equal(names(['packages/ab/deno.json']), ['./packages/ab/deno.json'])
  equal(names(['workers/yak/a.ts', 'packages/abc/a.ts']), [])
})

let file = Deno.makeTempFileSync({ suffix: '.ts' })
let called: Check[] = []
let files = await format([file, `${file}.deleted`], (c) => {
  called.push(c)
  return Promise.resolve(true)
})
let failed = await check(files, (c) => {
  called.push(c)
  return Promise.resolve(c.name != 'lint')
}, () => Promise.resolve([]))
let refused = await check(
  ['packages/a/a.md'],
  (c) => Promise.resolve(!c.name.startsWith('publish')),
  () => Promise.resolve([{ name: '@a/a', config: 'packages/a/deno.json' }]),
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
