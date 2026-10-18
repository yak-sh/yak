import { equal, test } from '@yaks/testing'
import { getStarts } from './get_starts.ts'
let dir = await Deno.makeTempDir()
let db = `${dir}/db`
let now = 1000
let take = getStarts(db, 123, () => now)
equal(take(), false)
await Deno.writeTextFile(
  `${db}.get-starts.json`,
  JSON.stringify({ pid: 123, arm: 'one', next: 2, until: 2000 }),
)
now = 1250
test('armed GET starts are bounded and the same arm cannot refill them', () => {
  equal([take(), take(), take()], [true, true, false])
  now = 1500
  equal(take(), false)
  now = 2500
  equal(take(), false)
})
let other = getStarts(db, 456, () => 1500)
test('GET starts belong only to their target PID', () => equal(other(), false))
