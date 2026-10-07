/** Short-lived tracker tickets issued by a trusted host. The tracker use has
 * its own HMAC key, matching the platform's sealed-value protocol. No ticket
 * or secret is stored; callers issue one at the moment they read remotely. */
export type Access = {
  scope: string
  person: string
  exp: number
  admin?: boolean
}
let enc = new TextEncoder()
let b64 = (bytes: Uint8Array<ArrayBuffer>) =>
  btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_')
    .replace(/=+$/, '')
let key = (bytes: Uint8Array<ArrayBuffer>) =>
  crypto.subtle.importKey(
    'raw',
    bytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
/** Signs the same tracker ticket that the Worker's authorization opens. */
export let sign = async (access: Access, secret: string): Promise<string> => {
  let derived = await crypto.subtle.sign(
    'HMAC',
    await key(enc.encode(secret)),
    enc.encode('yaks.app/tracker'),
  )
  let body = b64(enc.encode(JSON.stringify(access)))
  let mac = await crypto.subtle.sign(
    'HMAC',
    await key(new Uint8Array(derived)),
    enc.encode(body),
  )
  return `${body}.${b64(new Uint8Array(mac))}`
}
