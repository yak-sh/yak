import { equal, test } from '@yaks/testing'
import { type Check, check, checks, format } from './test-checks.ts'

let planned = checks(['a.ts', 'doc.md', 'data.json', 'image.png'], [
  'a_test.ts',
  'a.ts',
  'README.md',
])

test('source checks format and lint the change and type check its consumers once', () => {
  equal(planned, [
    { name: 'format', args: ['fmt', 'a.ts', 'doc.md', 'data.json'] },
    { name: 'lint', args: ['lint', 'a.ts'] },
    {
      name: 'types',
      args: ['check', '--quiet', '--frozen', '--doc', 'a.ts', 'a_test.ts'],
    },
    {
      name: 'docs',
      args: [
        'check',
        '--quiet',
        '--frozen',
        '--doc-only',
        'doc.md',
        'README.md',
      ],
    },
  ])
  equal(checks([], []), [])
})

let file = Deno.makeTempFileSync({ suffix: '.ts' })
let called: Check[] = []
let files = await format([file, `${file}.deleted`], (c) => {
  called.push(c)
  return Promise.resolve(true)
})
let failed = await check(files, ['consumer_test.ts'], (c) => {
  called.push(c)
  return Promise.resolve(c.name != 'types')
})
Deno.removeSync(file)

test('deleted files are omitted and a type failure fails the run despite passing lint', () => {
  equal(files, [file])
  equal(called.map((c) => c.name), ['format', 'lint', 'types'])
  equal(failed, false)
})
