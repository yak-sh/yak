// The ambient tally (hops.ts): a hop counts on the tally that is running, the
// header rolls the bucket's verbs into one number, and a nested tally is its
// own.
import { assertEquals } from '@std/assert'
import { counts, hop, type Tally, tallying } from './hops.ts'

Deno.test('a hop counts on the tally that is running, and nowhere else', () => {
  let tally: Tally = new Map()
  // Outside every `tallying`, a hop is a no-op — a seam called by a script,
  // a boot, or a test is not a request and has nobody to report to.
  hop('hops')
  assertEquals(tally.size, 0)
  tallying(tally, () => {
    hop('hops')
    hop('hops')
    hop('r2.get')
    hop('r2.put', 3)
  })
  // The header's two numbers: store hops as they were named, and every `r2.*`
  // verb summed, since what a caller spent is how many times the bucket was
  // asked and not which verb asked it.
  assertEquals(counts(tally), { hops: 2, r2: 4 })
  hop('hops')
  assertEquals(counts(tally).hops, 2)
})

Deno.test('a nested tally is the inner one, and the outer resumes', () => {
  let outer: Tally = new Map()
  let inner: Tally = new Map()
  tallying(outer, () => {
    hop('hops')
    tallying(inner, () => hop('hops'))
    hop('hops')
  })
  assertEquals([counts(outer).hops, counts(inner).hops], [2, 1])
})
