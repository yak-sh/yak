// Sign-in mail may arrive late, but its code remains usable until expiry.
import { clock, equal, test } from '@yaks/testing'
import { assertRejects } from '@std/assert'
import { codeFor } from './signin-mail.ts'

let address = 'probe@bot.yak.sh'
let letter = [{
  entity: { eid: 'letter' },
  doc: { title: '123456 is your yaks.app code' },
  mail: { to: address, at: new Date(0).toISOString() },
}]

test('sign-in spends a code delivered after the old ninety-second cutoff', async () => {
  let time = clock()
  let code = await codeFor(
    () => time.now() >= 120_000 ? letter : [],
    address,
    0,
    { now: time.now, sleep: time.advance, poll: 30_000 },
  )
  equal(code, '123456')
  equal(time.now(), 120_000)
})

test('sign-in stops waiting when its requested code expires, not ten minutes later', async () => {
  let time = clock(590_000)
  await assertRejects(
    () =>
      codeFor(
        () => time.now() >= 600_000 ? letter : [],
        address,
        0,
        { now: time.now, sleep: time.advance },
      ),
    Error,
    'no sign-in code',
  )
  equal(time.now(), 600_000)
})
