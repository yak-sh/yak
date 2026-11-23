// A phone provider slow to answer is reported only once it stays slow for an
// hour, as one bug, and an answer ends its run (phone-slow.ts).
import { equal, test } from '@yaks/testing'
import { Unsent } from '@yaks/host/senders'
import { fresh } from './probe.ts'
import { within } from './defects.ts'
import { noted, SLOW, tally } from './phone-slow.ts'
import type { Env } from './env.ts'

let env!: Env
let k = await fresh({}, (e) => {
  env = e
})
let now = Date.now()
let slow = new Unsent('voip.ms is slow to answer getSubAccounts right now')
let minutes = (n: number) => void (now += n * 60_000)
// Each note in an invocation of its own, as each pass and call is.
let note = (via: string, error?: Unsent) =>
  within(env, {}, () => noted(env, via, error, now))
let told = async (via: string) => {
  await k.flushReports()
  return k.reported.filter((r) =>
    JSON.stringify(r).includes(`${via} slow for 1h`) && 'error' in r
  ).length
}

test('a provider slow for an hour is reported once, and not before', async () => {
  await note('slowpoke', slow)
  minutes(59)
  await note('slowpoke', slow)
  equal(await told('slowpoke'), 0)
  minutes(SLOW / 60_000 - 58)
  await note('slowpoke', slow)
  minutes(60)
  await note('slowpoke', slow)
  equal(await told('slowpoke'), 1)
})

test('an answer ends the run, so slowness after it starts the hour again', async () => {
  await note('flaky', slow)
  minutes(50)
  await note('flaky')
  minutes(20)
  await note('flaky', slow)
  equal(await told('flaky'), 0)
})

test('a pass is slow only where its provider answered none of it', async () => {
  let met = tally()
  met.slow('mixed', slow)
  met.answered('mixed')
  met.slow('mixed', slow)
  met.slow('down', slow)
  await within(env, {}, () => met.settle(env, now))
  minutes(61)
  let again = tally()
  again.slow('mixed', slow)
  again.slow('down', slow)
  await within(env, {}, () => again.settle(env, now))
  equal([await told('mixed'), await told('down')], [0, 1])
})
