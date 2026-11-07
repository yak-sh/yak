// A browser that allowed notifications, for proofs: it subscribes at an
// endpoint, and opens and checks what a push service was handed for it, the
// way a browser and a push service would.
import {
  base64url,
  bytesOf,
  messageKeys,
  shared,
  type Subscription,
} from './mod.ts'

let P256 = { name: 'ECDH', namedCurve: 'P-256' } as const

/** What a push request carried, opened: its words and its VAPID claims. */
export type Opened = {
  payload: string
  claims: { aud: string; exp: number; sub: string }
  key: string
}

/** A browser of its own keys, subscribed at `endpoint`. */
export let browser = async (endpoint: string): Promise<{
  subscription: Subscription
  opened: (request: Request) => Promise<Opened>
}> => {
  let pair = await crypto.subtle.generateKey(P256, true, ['deriveBits'])
  let own = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
  let auth = crypto.getRandomValues(new Uint8Array(16))
  let opened = async (request: Request): Promise<Opened> => {
    let [, t, k] = request.headers.get('authorization')!
      .match(/^vapid t=([^,]+), k=(.+)$/)!
    let [head, body, signature] = t.split('.')
    let verifier = await crypto.subtle.importKey(
      'raw',
      bytesOf(k),
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    )
    let valid = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      verifier,
      bytesOf(signature),
      new TextEncoder().encode(`${head}.${body}`),
    )
    if (!valid) throw new Error('The VAPID token is not signed by its key')
    let bytes = new Uint8Array(await request.arrayBuffer())
    let salt = bytes.slice(0, 16), length = bytes[20]
    let server = bytes.slice(21, 21 + length)
    let { key, nonce } = await messageKeys(
      await shared(pair.privateKey, server),
      auth,
      own,
      server,
      salt,
    )
    let plain = new Uint8Array(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: nonce },
        key,
        bytes.slice(21 + length),
      ),
    )
    let end = plain.lastIndexOf(2)
    return {
      payload: new TextDecoder().decode(plain.slice(0, end)),
      claims: JSON.parse(new TextDecoder().decode(bytesOf(body))),
      key: k,
    }
  }
  return {
    subscription: {
      endpoint,
      keys: { p256dh: base64url(own), auth: base64url(auth) },
    },
    opened,
  }
}
