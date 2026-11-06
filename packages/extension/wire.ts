// The frames between a host's agent and a browser that lends it a tab, said
// once for every host: a call goes to the browser, an answer comes back with
// the call's id. The socket they travel on is the host's; how a browser opens
// it with its bearer token is said here too (`protocols`, `bearerOf`), since
// both ends must agree on it.

import { fromBase64url, toBase64url } from '@yaks/fp'

/** A tool call the host sends the browser. */
export type Call = { call: { id: string; tool: string; args: Args } }

/** The arguments a call carries, as the model gave them. */
export type Args = Record<string, unknown>

/** An image an answer carries, base64 so it fits a text frame. */
export type Shot = { mime: string; base64: string }

/** What the browser answers a call: words for the model, an image beside
 * them, or why it could not. */
export type Answer = {
  answer: { id: string; text?: string; image?: Shot; error?: string }
}

/** A call frame. */
export let call = (id: string, tool: string, args: Args = {}): string =>
  JSON.stringify({ call: { id, tool, args } } satisfies Call)

/** An answer frame. */
export let answer = (a: Answer['answer']): string =>
  JSON.stringify({ answer: a } satisfies Answer)

let parsed = (data: unknown): Record<string, unknown> | null => {
  if (typeof data != 'string') return null
  try {
    let v = JSON.parse(data)
    return v && typeof v == 'object' ? v : null
  } catch {
    return null
  }
}

/** The call a frame holds, or null for anything else. */
export let callOf = (data: unknown): Call['call'] | null => {
  let c = parsed(data)?.call as Call['call'] | undefined
  return c && typeof c.id == 'string' && typeof c.tool == 'string'
    ? { id: c.id, tool: c.tool, args: c.args ?? {} }
    : null
}

/** The answer a frame holds, or null for anything else. */
export let answerOf = (data: unknown): Answer['answer'] | null => {
  let a = parsed(data)?.answer as Answer['answer'] | undefined
  return a && typeof a.id == 'string' ? a : null
}

/** A frame the browser sends every so often to keep its socket open. A host
 * answers nothing and ignores it, as it ignores every frame that is not an
 * answer. */
export let PING = '{"ping":true}'

// A browser's WebSocket can set no header, so the bearer token rides in the
// subprotocol list beside the plain `yaks` the host answers with. base64url
// without padding, because a subprotocol is an HTTP token and `=` is not one.
/** The subprotocol the socket speaks, and the one the host's 101 names. */
export let PROTOCOL = 'yaks'

let BEARER = 'bearer.'

/// protocols('abc') -> ['yaks', 'bearer.YWJj']
/** The subprotocols a browser opens its socket with, for a bearer token. */
export let protocols = (token: string): string[] => [
  PROTOCOL,
  BEARER + toBase64url(new TextEncoder().encode(token)),
]

/// bearerOf('yaks, bearer.YWJj') -> 'abc'
/// bearerOf('yaks') -> null
/// bearerOf(null) -> null
/** The bearer token a socket's `sec-websocket-protocol` header carries, or
 * null when it carries none. */
export let bearerOf = (header: string | null): string | null => {
  let named = header?.split(',').map((p) => p.trim())
    .find((p) => p.startsWith(BEARER))
  if (!named) return null
  try {
    return new TextDecoder('utf-8', { fatal: true })
      .decode(fromBase64url(named.slice(BEARER.length))) || null
  } catch {
    return null
  }
}
