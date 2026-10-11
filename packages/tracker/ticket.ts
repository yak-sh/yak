/** Short-lived tracker tickets issued by a trusted host. The tracker use has
 * its own HMAC key, matching the platform's sealed-value protocol. No ticket
 * or secret is persisted; callers issue one when they call remotely. */
export type Access = {
  scope: string
  person: string
  exp: number
  admin?: boolean
  ingest?: boolean
  mark?: boolean
}
let enc = new TextEncoder()
let b64 = (bytes: Uint8Array<ArrayBuffer>) =>
  bytes.toBase64({ alphabet: 'base64url', omitPadding: true })
let key = (bytes: Uint8Array<ArrayBuffer>) =>
  crypto.subtle.importKey(
    'raw',
    bytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
// The signing key belongs to the configured secret, not to a ticket. Keep
// only the latest nonextractable key; a rotation derives its replacement.
let held:
  | { secret: string; key: CryptoKey; body?: string; ticket?: string }
  | undefined
let signingKey = async (secret: string) => {
  if (held?.secret == secret) return held.key
  let derived = await crypto.subtle.sign(
    'HMAC',
    await key(enc.encode(secret)),
    enc.encode('yaks.app/tracker'),
  )
  let result = await key(new Uint8Array(derived))
  held = { secret, key: result }
  return result
}
/** Signs the same tracker ticket that the Worker's authorization opens. */
export let sign = async (access: Access, secret: string): Promise<string> => {
  let body = b64(enc.encode(JSON.stringify(access)))
  let key = await signingKey(secret)
  // Signing is deterministic. An identical body (including its expiry) under
  // this key needs no new MAC; changed claims and rotated secrets always do.
  if (held?.key == key && held.body == body) return held.ticket!
  let mac = await crypto.subtle.sign(
    'HMAC',
    key,
    enc.encode(body),
  )
  let ticket = `${body}.${b64(new Uint8Array(mac))}`
  if (held?.key == key) Object.assign(held, { body, ticket })
  return ticket
}
