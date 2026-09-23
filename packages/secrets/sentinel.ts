// The sentinel: what the graph keeps where a secret's value was written.
//
// It is a salted hash of the value — an HMAC under a key only the vault holds —
// so it is stable (writing the same value again changes nothing), it cannot be
// walked back to the value, and it cannot be guessed from a guessed value
// without the salt. That is what makes it safe to show anyone: an agent may
// read it, a config may name it, a page may embed it, and none of them can do
// anything with it but hand it to code trusted to swap it for the value.
//
// The prefix is how a reader tells a sentinel from a value. A write carrying a
// sentinel is somebody writing back what they read, and changes nothing.

/** What every sentinel starts with. */
export let PREFIX = 'yak_secret_'

/** Whether a string is a sentinel rather than a value. */
export let isSentinel = (s: string): boolean => s.startsWith(PREFIX)

let b64url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_')
    .replace(/=+$/, '')

/** The sentinel for a value, under a vault's salt. */
export let sentinel = async (
  salt: Uint8Array,
  value: string,
): Promise<string> => {
  let key = await crypto.subtle.importKey(
    'raw',
    salt as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  let mac = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(value),
  )
  return PREFIX + b64url(new Uint8Array(mac))
}
