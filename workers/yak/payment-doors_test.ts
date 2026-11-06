// The payment provider's doors as the Worker answers them (payment-doors.ts):
// what a door refuses is one sentence, and a door nobody switched on says so.
import { equal, test } from '@yaks/testing'
import type { Env, Vars } from './env.ts'
import { paymentDoor } from './payment-doors.ts'

let ON = { STRIPE_CONNECT_WEBHOOK_SECRET: 'whsec_probe' } as Vars as Env

let answer = async (path: string, init: RequestInit = {}, env = ON) => {
  let r = await paymentDoor(new Request(`https://yaks.app${path}`, init), env)
  return r && [r.status, (await r.json()).error?.code]
}

let POST = { method: 'POST', body: '{}' }

test('a door answers what it refuses, and a door switched off says so', async () => {
  equal(await answer('/stripe/connect', POST), [400, 'bad_signature'])
  equal(await answer('/stripe/connect'), [405, 'method_not_allowed'])
  equal(await answer('/stripe/webhook', POST), [503, 'not_switched_on'])
})

test('a path the provider lends no door at is not its to answer', async () => {
  equal(await answer('/stripe/nothing', POST), null)
  equal(await answer('/stripe/connect/more', POST), null)
  equal(await answer('/elsewhere/connect', POST), null)
})
