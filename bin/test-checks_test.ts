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

let file = Deno.makeTempFileSync({ suffix: '.ts' })
let called: Check[] = []
let files = await format([file, `${file}.deleted`], (c) => {
  called.push(c)
  return Promise.resolve(true)
})
let failed = await check(files, (c) => {
  called.push(c)
  return Promise.resolve(c.name != 'lint')
})
Deno.removeSync(file)

test('deleted files are omitted and a lint failure fails the run', () => {
  equal(files, [file])
  equal(called.map((c) => c.name), ['format', 'lint'])
  equal(failed, false)
})
