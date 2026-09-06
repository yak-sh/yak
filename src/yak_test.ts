// The `yak` CLI's verb table at its pure seam: what a verb refuses before it
// touches an account or the network. The rest of a verb is the wire
// (yaks_api_test.ts) and the account rule (yaks_account_test.ts); what is left
// here is the argv a person actually types.
import { assertRejects } from '@std/assert'
import { parse, verbs } from './yak.ts'
import { Refused } from './yaks_account.ts'

let said = (verb: string, argv: string[]) => parse(verb, verbs[verb], argv)

// The fee is the PLATFORM's (workers/yak/sell.ts `fees`), so reading it or
// moving it is a named act — never something a default or a throwaway arrives
// at. Both refusals land before any account is read, so a typo costs nothing.
Deno.test('the fee verb refuses a rate nobody named as the owner', async () => {
  await assertRejects(
    () => Promise.resolve(verbs.fee.run(said('fee', ['250']))),
    Refused,
    '--owner',
  )
  await assertRejects(
    () => Promise.resolve(verbs.fee.run(said('fee', []))),
    Refused,
  )
})

Deno.test('the fee verb refuses anything but whole basis points', async () => {
  for (let no of ['2.5', '-5', 'lots', '2,50']) {
    await assertRejects(
      () => Promise.resolve(verbs.fee.run(said('fee', [no, '--owner']))),
      Error,
      'basis points',
    )
  }
})
