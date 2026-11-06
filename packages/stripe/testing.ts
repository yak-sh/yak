// What Stripe sends, for a test that stands in for it.

/**
 * A `Stripe-Signature` header over exactly these bytes: HMAC-SHA256 of
 * `<timestamp>.<raw body>`, keyed by the endpoint's signing secret. The scheme
 * is the same for a platform endpoint and a Connect one; only the secret
 * differs. @yaks/hook's `refusal('stripe', …)` verifies it.
 */
export let signed = async (
  secret: string,
  raw: string,
  at: number,
): Promise<string> => {
  let key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  let mac = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${at}.${raw}`),
  )
  let hex = [...new Uint8Array(mac)]
    .map((n) => n.toString(16).padStart(2, '0')).join('')
  return `t=${at},v1=${hex}`
}

/**
 * A subscription shaped the way ./plans.ts `read` reads one, and no more,
 * tagged with `metadata`: active, paid a month ahead, under ids of its own. A
 * `customer.subscription.*` event carries its subscription whole and is read
 * without asking Stripe back, so this stands in for one Stripe never held.
 * `over` sets the fields a particular delivery turns on, such as a
 * cancellation's `status` and `ended_at`.
 */
export let fakeSub = (
  metadata: Record<string, string>,
  over: Record<string, unknown> = {},
) => {
  let id = crypto.randomUUID().replaceAll('-', '')
  return {
    id: `sub_probe${id}`,
    customer: `cus_probe${id}`,
    status: 'active',
    metadata,
    current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400,
    ...over,
  }
}

/**
 * An event about `object`, signed with `secret` as Stripe signs it and posted
 * to `path` through `post`: the door's answer, or a throw where it refused.
 * `on` is the connected account the event is about, which Stripe puts on the
 * envelope rather than in the object; `at` is when Stripe made it, and a
 * redelivery is the same event again, so a test that replays one passes the
 * same moment twice.
 */
export let delivered = async (
  post: (path: string, init: RequestInit) => Promise<Response>,
  path: string,
  secret: string,
  type: string,
  object: unknown,
  on?: string,
  at: number = Math.floor(Date.now() / 1000),
): Promise<string> => {
  let raw = JSON.stringify({
    id: `evt_${crypto.randomUUID()}`,
    type,
    created: at,
    // The envelope says the object's mode, which is the sandbox's unless the
    // object says otherwise.
    livemode: (object as { livemode?: boolean }).livemode ?? false,
    ...(on ? { account: on } : {}),
    data: { object },
  })
  let r = await post(path, {
    method: 'POST',
    body: raw,
    headers: {
      'content-type': 'application/json',
      'stripe-signature': await signed(secret, raw, at),
    },
  })
  let said = await r.text()
  if (!r.ok) throw new Error(`${path}: ${r.status} ${said}`)
  return said
}
