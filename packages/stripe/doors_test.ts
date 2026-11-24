// Stripe's doors (doors.ts): each hears only what Stripe signed with its own
// secret, and reads it into the host's words.
import { equal, test } from '@yaks/testing'
import { doors } from './doors.ts'
import { signed } from './testing.ts'

let SECRETS = { webhook: 'whsec_platform', connect: 'whsec_connect' }
let open = doors({ doors: SECRETS })
let AT = Math.floor(Date.now() / 1000)

let posted = (raw: string, signature?: string) =>
  new Request('https://yaks.app/stripe/connect', {
    method: 'POST',
    body: raw,
    headers: signature ? { 'stripe-signature': signature } : {},
  })

let RAW = JSON.stringify({ type: 'account.updated', account: 'acct_1' })
let said = async (door: string, raw: string, signature?: string) => {
  let out = await open[door](posted(raw, signature))
  return out && ('heard' in out ? out.heard.about : out)
}

test('a door hears only what its own secret signed', async () => {
  equal(await said('connect', RAW), {
    refused: 'no Stripe-Signature header',
    ours: false,
  })
  equal(await said('connect', RAW, await signed('whsec_x', RAW, AT - 3600)), {
    refused: 'the signature is too old',
    ours: false,
  })
  // The platform's secret is not the Connect endpoint's: a well-formed
  // signature that does not match is what a wrong secret looks like, so it is
  // the host's to report.
  equal(await said('connect', RAW, await signed(SECRETS.webhook, RAW, AT)), {
    refused: 'the signature does not match',
    ours: true,
  })
  equal(
    await said('connect', RAW, await signed(SECRETS.connect, RAW, AT)),
    'seller',
  )
  let sub = JSON.stringify({ type: 'customer.subscription.updated' })
  equal(
    await said('webhook', sub, await signed(SECRETS.webhook, sub, AT)),
    'subscription',
  )
})

test('a door with no secret hears nothing', async () => {
  equal(await doors({}).webhook(posted(RAW)), undefined)
})

test('the platform’s door hears a house sale as a sale and its plans as plans', async () => {
  let heard = async (type: string, object: Record<string, unknown>) => {
    let raw = JSON.stringify({ type, data: { object } })
    let out = await open.webhook(
      posted(raw, await signed(SECRETS.webhook, raw, AT)),
    )
    return out && 'heard' in out
      ? [out.heard.about, 'account' in out.heard ? out.heard.account : null]
      : out
  }
  let session = { mode: 'payment', payment_status: 'paid' }
  equal(
    await heard('checkout.session.completed', {
      ...session,
      metadata: { space: 'e-space', house: 'true' },
    }),
    ['sale', ''],
  )
  equal(
    await heard('checkout.session.completed', {
      ...session,
      metadata: { space: 'e-space', credit: '5' },
    }),
    ['purchase', null],
  )
  equal(
    await heard('charge.refunded', { payment_intent: 'pi_1' }),
    ['payment', ''],
  )
  equal(await heard('refund.created', { id: 're_1' }), ['refund', ''])
  equal(await heard('invoice.paid', {}), ['subscription', null])
})
