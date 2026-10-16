// Repeated machine lends share one directory scan, including while a slow
// scan is still in flight. The clock and scan are inputs, not real delays.

import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { tidier } from './tidy.ts'
import { store } from './store.ts'
import { tracked } from './testing.ts'

let HOUR = 60 * 60 * 1000
let processes = store(tracked())

test('tidy shares its throttle by directory and never overlaps a sweep', async () => {
  let now = 0
  let calls: string[] = []
  let finish!: (n: number) => void
  let pending = Promise.resolve(0)
  let tidy = tidier((_age, opts) => {
    calls.push(opts!.dir!)
    pending = new Promise<number>((go) => finish = go)
    return pending
  }, () => now)
  let at = Deno.cwd()
  tidy(processes, { dir: `${at}/processes` })
  tidy(processes, { dir: `${at}/processes/../processes` })
  now += 2 * HOUR
  tidy(processes, { dir: `${at}/processes` })
  assertEquals(calls, [`${at}/processes`])
  finish(0)
  await pending
  // Let the sweep's catch/finally settle, without advancing the clock.
  await Promise.resolve()
  tidy(processes, { dir: `${at}/processes` })
  assertEquals(calls.length, 1)
  now += HOUR
  tidy(processes, { dir: `${at}/processes` })
  assertEquals(calls.length, 2)
  finish(0)
  await pending
  tidy(processes, { dir: `${at}/other` })
  assertEquals(calls.length, 3)
  finish(0)
  await pending
})
