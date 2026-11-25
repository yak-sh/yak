import { equal, test } from '@yaks/testing'
import { type Check, check, checks, format } from './test-checks.ts'
import config from '../deno.json' with { type: 'json' }
import { formatting } from '@yaks/git/land'

let planned = checks(['a.ts', 'doc.md', 'data.json', 'image.png'])

test('source checks format, lint and byte-check the change', () => {
  equal(planned, [
    {
      name: 'format',
      args: [
        ...formatting([], config),
        'a.ts',
        'doc.md',
        'data.json',
      ],
    },
    {
      name: 'lint',
      args: ['lint', '--config', 'deno.json', '--permit-no-files', 'a.ts'],
    },
    {
      name: 'bytes',
      args: [
        'run',
        '--allow-read',
        'bin/check-bytes.ts',
        'a.ts',
        'doc.md',
        'data.json',
        'image.png',
      ],
    },
  ])
  equal(checks([]), [])
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
  types(true),
)
let untyped = await check(
  ['a.ts'],
  () => Promise.resolve(true),
  types(false),
)
Deno.removeSync(file)

test('deleted files are omitted and a lint failure fails the run', () => {
  equal(files, [file])
  equal(called.map((c) => c.name), ['format', 'lint', 'bytes'])
  equal(failed, false)
})

test('the types of what the change reaches are checked, and their failure fails the run', () => {
  equal(typed, [[file], ['a.ts']])
  equal(untyped, false)
})
