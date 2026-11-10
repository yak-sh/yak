// Read Rails 8's existing JSON credentials with their original purpose and
// expiry. Keys arrive through a trusted boundary; this module never loads an
// environment variable, rotates a credential or grants a graph membership.
export type RailsKeys = {
  signed: Uint8Array
  encrypted: Uint8Array
  storage: Uint8Array
}
let bytes = (value: Uint8Array): ArrayBuffer => Uint8Array.from(value).buffer
let utf8 = (value: string): Uint8Array => new TextEncoder().encode(value)
let text = (value: Uint8Array): string =>
  new TextDecoder('utf-8', { fatal: true }).decode(value)
let base64 = (value: string): Uint8Array =>
  Uint8Array.from(
    atob(value.replaceAll('-', '+').replaceAll('_', '/')),
    (c) => c.charCodeAt(0),
  )
let hex = (value: string): Uint8Array =>
  Uint8Array.from(value.match(/../g) ?? [], (v) => parseInt(v, 16))

/** Derive only the original Rails purposes, locally. A target can receive
 * these scoped keys instead of the source application's SECRET_KEY_BASE. */
export let railsKeys = async (secret: string): Promise<RailsKeys> => {
  let key = await crypto.subtle.importKey(
    'raw',
    bytes(utf8(secret)),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  let derive = async (salt: string, length: number) =>
    new Uint8Array(
      await crypto.subtle.deriveBits(
        {
          name: 'PBKDF2',
          hash: 'SHA-256',
          iterations: 1000,
          salt: bytes(utf8(salt)),
        },
        key,
        length * 8,
      ),
    )
  let [signed, encrypted, storage] = await Promise.all([
    derive('signed cookie', 64),
    derive('authenticated encrypted cookie', 32),
    derive('ActiveStorage', 64),
  ])
  return { signed, encrypted, storage }
}

let envelope = (body: string, purpose: string, now: string): unknown => {
  let value = JSON.parse(body)
  let metadata = value?._rails
  if (!metadata || metadata.pur !== purpose) return null
  if (
    metadata.exp &&
    (!Number.isFinite(Date.parse(metadata.exp)) ||
      Date.parse(now) >= Date.parse(metadata.exp))
  ) return null
  return 'message' in metadata
    ? JSON.parse(text(base64(metadata.message)))
    : metadata.data
}

let cookie = (request: Request, name: string): string | undefined => {
  let encoded = (request.headers.get('cookie') ?? '').split(';').map((part) =>
    part.trim()
  ).find((part) => part.startsWith(name + '='))?.slice(name.length + 1)
  try {
    return encoded === undefined ? undefined : decodeURIComponent(encoded)
  } catch {
    return undefined
  }
}

export type Rails = {
  signed: (
    value: string,
    purpose: string,
    now: string,
    storage?: boolean,
  ) => Promise<unknown>
  encrypted: (value: string, purpose: string, now: string) => Promise<unknown>
  identity: (
    request: Request,
    now: string,
  ) => Promise<{ user?: string; guest?: string; resume?: string }>
  blob: (value: string, now: string) => Promise<string | undefined>
}

/** Invalid caller credentials return no claim. Invalid key configuration throws
 * before reading a credential, so the host can report the configuration error. */
export let rails = async (keys: RailsKeys): Promise<Rails> => {
  if (
    keys.signed.length !== 64 || keys.encrypted.length !== 32 ||
    keys.storage.length !== 64
  ) throw Error('Invalid Rails migration key lengths')
  let hmac = async (key: Uint8Array) =>
    await crypto.subtle.importKey(
      'raw',
      bytes(key),
      { name: 'HMAC', hash: 'SHA-1' },
      false,
      ['verify'],
    )
  let [signedKey, storageKey, encryptedKey] = await Promise.all([
    hmac(keys.signed),
    hmac(keys.storage),
    crypto.subtle.importKey('raw', bytes(keys.encrypted), 'AES-GCM', false, [
      'decrypt',
    ]),
  ])
  let signed: Rails['signed'] = async (
    value,
    purpose,
    now,
    storage = false,
  ) => {
    let separator = value.lastIndexOf('--')
    if (separator < 0 || !/^[a-f0-9]{40}$/.test(value.slice(separator + 2))) {
      return null
    }
    let encoded = value.slice(0, separator)
    if (
      !await crypto.subtle.verify(
        'HMAC',
        storage ? storageKey : signedKey,
        bytes(hex(value.slice(separator + 2))),
        bytes(utf8(encoded)),
      )
    ) return null
    try {
      return envelope(text(base64(encoded)), purpose, now)
    } catch {
      return null
    }
  }
  let encrypted: Rails['encrypted'] = async (value, purpose, now) => {
    let parts = value.split('--')
    if (parts.length !== 3) return null
    let encrypted: Uint8Array, iv: Uint8Array, tag: Uint8Array
    try {
      ;[encrypted, iv, tag] = parts.map(base64)
    } catch {
      return null
    }
    let joined = new Uint8Array(encrypted.length + tag.length)
    joined.set(encrypted)
    joined.set(tag, encrypted.length)
    try {
      let decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: bytes(iv), tagLength: 128 },
        encryptedKey,
        bytes(joined),
      )
      return envelope(text(new Uint8Array(decrypted)), purpose, now)
    } catch (error) {
      if (
        error instanceof SyntaxError || error instanceof TypeError ||
        (error instanceof DOMException && error.name === 'OperationError')
      ) return null
      throw error
    }
  }
  let identity: Rails['identity'] = async (request, now) => {
    let session = cookie(request, '_coloring_book_maker_session')
    let guest = cookie(request, 'cb_guest'),
      resume = cookie(request, 'fp_session')
    let data = session
      ? await encrypted(session, 'cookie._coloring_book_maker_session', now) as
        | Record<string, unknown>
        | null
      : null
    let guestId = guest ? await signed(guest, 'cookie.cb_guest', now) : null
    let token = resume ? await signed(resume, 'cookie.fp_session', now) : null
    return {
      ...(data?.user_id ? { user: String(data.user_id) } : {}),
      ...(guestId ? { guest: String(guestId) } : {}),
      ...(typeof token === 'string' ? { resume: token } : {}),
    }
  }
  let blob: Rails['blob'] = async (value, now) => {
    let id = await signed(value, 'blob_id', now, true)
    return (typeof id === 'string' || typeof id === 'number') &&
        /^\d+$/.test(String(id))
      ? String(id)
      : undefined
  }
  return { signed, encrypted, identity, blob }
}
