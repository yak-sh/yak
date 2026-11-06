// What Stripe sends, for a test that stands in for it.

/**
 * A `Stripe-Signature` header over exactly these bytes: HMAC-SHA256 of
 * `<timestamp>.<raw body>`, keyed by the endpoint's signing secret. The scheme
 * is the same for a platform endpoint and a Connect one; only the secret
 * differs. @yaks/hook's `refusal('stripe', …)` verifies it.
 */
export let signed = async (secret: string, raw: string, at: number) => {
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
