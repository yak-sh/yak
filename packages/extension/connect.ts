// The connection: which host an extension is made for, and the socket it holds
// to one space there once the person signed in. A **configuration** is the
// host as data (`{name, origin, socket, description?}`), the one thing two of
// these extensions differ by. A **space** is where the person's agent runs,
// served at `<space>.<host>`.

import { protocols } from './wire.ts'

/** The host an extension is made for. */
export type Config = {
  /** What the person knows the host as, such as `yaks.app`. */
  name: string
  /** Where it signs in, such as `https://yaks.app`. */
  origin: string
  /** The socket a space's agent is reached on, `{space}` standing for the
   * space, such as `wss://yaks.app/manage/{space}/operator?browser=1`. */
  socket: string
  /** One line saying what the extension does, for the browser's listing. */
  description?: string
}

/** A person signed in, with the space they chose. */
export type Signed = { token: string; space: string }

/** The configuration a JSON value holds, or a sentence saying what is wrong
 * with it. */
export let configOf = (v: unknown): Config | string => {
  if (!v || typeof v != 'object') return 'A configuration is a JSON object.'
  let { name, origin, socket, description }: Record<string, unknown> = { ...v }
  if (typeof name != 'string' || !name) return 'It needs a `name`.'
  if (typeof origin != 'string' || !origin) return 'It needs an `origin`.'
  let at: URL
  try {
    at = new URL(origin)
  } catch {
    return `Its origin, ${origin}, is not an address.`
  }
  if (at.origin != origin) {
    return `Its origin is written ${at.origin}, with no path.`
  }
  if (typeof socket != 'string' || !/^wss?:\/\/.*\{space\}/.test(socket)) {
    return 'It needs a `socket`, a ws(s) address with `{space}` in it.'
  }
  if (description != null && typeof description != 'string') {
    return 'Its `description` is a sentence.'
  }
  return { name, origin, socket, ...(description ? { description } : {}) }
}

let SLUG = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

/// let config = { name: 'yaks.app', origin: 'https://yaks.app' }
/// spaceOf(config, ' Jeff ') -> 'jeff'
/// spaceOf(config, 'https://jeff.yaks.app/notes') -> 'jeff'
/// spaceOf(config, 'jeff.yaks.app') -> 'jeff'
/// spaceOf(config, 'not a space!') -> null
/** The space a person typed, as its name or its address, or null when it
 * names none. */
export let spaceOf = (
  config: Pick<Config, 'origin'>,
  typed: string,
): string | null => {
  let suffix = `.${new URL(config.origin).hostname}`
  let t = typed.trim().toLowerCase().replace(/^[a-z]+:\/\//, '')
    .replace(/[/?#].*$/, '')
  let name = t.endsWith(suffix) ? t.slice(0, -suffix.length) : t
  return SLUG.test(name) ? name : null
}

/// spaceHost({ name: 'yaks.app', origin: 'https://yaks.app' }, 'jeff') -> 'jeff.yaks.app'
/** Where a space is served. */
export let spaceHost = (
  config: Pick<Config, 'origin'>,
  space: string,
): string => `${space}.${new URL(config.origin).host}`

/** The socket's address and subprotocols: the configured door for the
 * person's space, with the bearer token in the subprotocols (./wire.ts). */
export let socket = (
  config: Config,
  signed: Signed,
): { url: string; protocols: string[] } => ({
  url: config.socket.replaceAll('{space}', encodeURIComponent(signed.space)),
  protocols: protocols(signed.token),
})
