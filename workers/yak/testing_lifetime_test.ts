import { test } from '@yaks/testing'
import { assertThrows } from '@std/assert'
import { lit, select } from '@yaks/sql'
import { platform } from './testing.ts'

let p = platform('alarm lifetime')
let store = p.object('lifetime/alarm')
let ctx = p.states.get('lifetime/alarm')!

// Drive an actual in-flight alarm and teardown once; assertions below check
// its completed storage boundary, not runtime scheduling of the alarm.
await (async () => {
  let entered = Promise.withResolvers<void>()
  let resume = Promise.withResolvers<void>()
  store.alarm = async () => {
    entered.resolve()
    await resume.promise
    ctx.storage.beneath(select({ cols: [lit(1)] }))
  }
  await ctx.storage.setAlarm(0)
  let ringing = p.ring()
  await entered.promise
  let closing = p[Symbol.asyncDispose]()
  resume.resolve()
  await Promise.all([ringing, closing])
})()
test('platform teardown retains storage through an active alarm delivery', () => {
  assertThrows(
    () => ctx.storage.beneath(select({ cols: [lit(1)] })),
    Error,
    'storage is disposed',
  )
})
