// One payer's plan checkout, reused or expired before its replacement opens.
import type { Checkout } from '@yaks/host/payments'
import { ask, type Keyed, list } from './mod.ts'

type Session = {
  id: string
  mode: string
  status: string
  client_reference_id: string
  metadata?: Record<string, string>
  url?: string
}

let digest = async (fields: Record<string, unknown>): Promise<string> =>
  [
    ...new Uint8Array(
      await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(JSON.stringify(fields)),
      ),
    ),
  ]
    .map((byte) => byte.toString(16).padStart(2, '0')).join('')

export let checkout = async (
  options: Keyed,
  asked: Checkout,
  fields: Record<string, unknown>,
): Promise<string> => {
  let fingerprint = await digest(fields)
  let open: Session[] = []
  let previous: string | undefined
  for await (
    let session of list<Session>(options, '/v1/checkout/sessions', {
      customer: asked.payer,
    })
  ) {
    if (
      session.mode != 'subscription' ||
      session.client_reference_id != asked.reference
    ) continue
    previous ??= session.id
    if (session.status == 'open') open.push(session)
  }
  let held = open.find((session) =>
    session.metadata?._checkout == fingerprint && session.url
  )
  for (let session of open) {
    if (session.id != held?.id) {
      await ask(
        options,
        `/v1/checkout/sessions/${encodeURIComponent(session.id)}/expire`,
        {},
      )
    }
  }
  if (held) return held.url!
  // The previous session is the durable identity of the next attempt. Two
  // callers seeing the same history create once through Stripe's idempotency.
  let made = await ask(
    options,
    '/v1/checkout/sessions',
    {
      ...fields,
      metadata: { ...asked.tags, _checkout: fingerprint },
    },
    undefined,
    'POST',
    `plan|${asked.reference}|${previous ?? asked.payer}`,
  )
  let url = String(made.url ?? '')
  if (!url) throw new Error('stripe made a checkout session with no url')
  return url
}
