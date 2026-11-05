import { assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { named } from './views.ts'

test('a process is named by its command up to the first option', () => {
  let cases: [string, string][] = [
    ['yak task new Buy the cake', 'yak task new Buy the cake'],
    [
      'yak serve --no-duties --share --ready /run/x.ready --config /y.json',
      'yak serve',
    ],
    ['yak session listen --session abc', 'yak session listen'],
    ['yak', 'yak'],
  ]
  for (let [command, name] of cases) assertEquals(named(command), name)
})
