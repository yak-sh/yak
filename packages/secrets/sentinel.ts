// The two strings that stand for a secret's value, and why there are two.
//
// The handle is what the graph keeps where a value was written: a random token,
// minted the first time a secret is written and kept for as long as it lives.
// Writing a new value — a rotation, a refreshed token — puts it behind the same
// handle. It is 256 random bits and says nothing about the value, so two
// secrets holding one value never share one. Anyone may read it: an agent, a
// config, a backup.
//
// The sentinel is what code that calls out is handed, and the only string a
// swap on the way out may ever replace with the value: the handle, hashed under
// the vault's salt. The salt never leaves the vault, so nobody reading the
// graph can compute a sentinel from a handle, and a bundle carrying handles
// around — a sync, an answer, a request that happens to quote one — is never
// swapped for a key by accident. It follows the handle, so it too survives a
// rotation.
//
// Each has its own prefix: how a reader tells a handle from a written value (a
// write carrying a handle is somebody writing back what they read, and changes
// nothing), and how a swap finds a sentinel in a request.

/** What every handle starts with. */
export let PREFIX = 'yak_secret_'

/** What every sentinel starts with. */
export let SENTINEL = 'yak_sentinel_'

/** Whether a string is a handle rather than a value. */
export let isHandle = (s: string): boolean => s.startsWith(PREFIX)

let b64url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_')
    .replace(/=+$/, '')

/** A new handle: the prefix and 256 random bits. */
export let handle = (): string =>
  PREFIX + b64url(crypto.getRandomValues(new Uint8Array(32)))

// A vault keeps its salt, so importing its HMAC key is setup shared by every
// handle under it. Copy the bytes used for the import: callers can change a
// salt buffer, and that must select a new key even while an import is pending.
type Signing = {
  bytes: Uint8Array
  key: Promise<CryptoKey>
  sentinels: Map<string, Promise<string>>
}
let keys = new WeakMap<Uint8Array, Signing>()
let signing = (salt: Uint8Array): Signing => {
  let kept = keys.get(salt)
  if (
    kept && kept.bytes.length == salt.length &&
    kept.bytes.every((b, i) => b == salt[i])
  ) return kept
  let bytes = salt.slice()
  let key = crypto.subtle.importKey(
    'raw',
    bytes as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  let next = { bytes, key, sentinels: new Map<string, Promise<string>>() }
  keys.set(salt, next)
  return next
}

/** The sentinel for a handle, under a vault's salt. */
export let sentinel = async (
  salt: Uint8Array,
  handle: string,
): Promise<string> => {
  let state = signing(salt)
  let found = state.sentinels.get(handle)
  if (found) return await found
  // Only deterministic public stand-ins are remembered. The vault remains
  // authoritative for which handle exists and what credential it holds.
  let made = state.key.then((key) =>
    crypto.subtle.sign('HMAC', key, new TextEncoder().encode(handle))
  ).then((mac) => SENTINEL + b64url(new Uint8Array(mac)))
  if (state.sentinels.size >= 128) {
    state.sentinels.delete(state.sentinels.keys().next().value!)
  }
  state.sentinels.set(handle, made)
  made.catch(() => {
    if (state.sentinels.get(handle) == made) state.sentinels.delete(handle)
  })
  return await made
}

// A sentinel as it appears in text: the prefix and a SHA-256 in base64url.
let FOUND = new RegExp(`${SENTINEL}[\\w-]{43}`, 'g')

/** Every sentinel a text carries. */
export let sentinels = (text: string): string[] => text.match(FOUND) ?? []

/** The text with each sentinel `values` has a value for replaced by it,
 * verbatim: the swap on the way out. */
export let swap = (text: string, values: Map<string, string>): string =>
  text.replace(FOUND, (s) => values.get(s) ?? s)
