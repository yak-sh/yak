// HMAC-SHA256 keys, each made once in an isolate and shared by signing and
// verification: a key is a WebCrypto call or three, and every request with a
// cookie or a sign-in code needs one. The key is kept, not the promise of it,
// so no request waits on work another request started.
let keys = new Map<string, CryptoKey>()
let enc = new TextEncoder()

export let HMAC = { name: 'HMAC', hash: 'SHA-256' }

/** The key kept under `id`, made by `make` the first time it is asked for. */
export let kept = async (id: string, make: () => Promise<CryptoKey>) => {
  let got = keys.get(id)
  if (!got) keys.set(id, got = await make())
  return got
}

/** The secret's own key, kept apart from every use's key made under it. */
export let hmac = (secret: string) =>
  kept(
    JSON.stringify([secret]),
    () =>
      crypto.subtle.importKey('raw', enc.encode(secret), HMAC, false, [
        'sign',
        'verify',
      ]),
  )
