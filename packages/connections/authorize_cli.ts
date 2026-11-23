// The CLI takes a private OAuth return from the browser or masked terminal input.

import * as system from '@yaks/process/system'
import { resolvers } from '@yaks/fp'
import { Refused } from '@yaks/graph/errors'
import { OAuthError } from '@yaks/oauth'
import type { Authorization, AuthReply } from './authorize.ts'
import {
  type BrowserReturn,
  type Listen,
  listen,
  loopback,
} from './loopback.ts'
import { REDIRECT } from './signin.ts'
export type { Authorization } from './authorize.ts'

export type AuthIO = {
  say: (line: string) => void
  /** Read a masked line. `onEnd` signals EOF without a line. */
  hidden: (signal?: AbortSignal, onEnd?: () => void) => Promise<string>
  listen?: Listen
}

let START = '\x1b[200~'
let END = '\x1b[201~'

/** Read one private line, including a terminal's bracketed paste protocol. */
export let readHidden = async (
  read: () => Promise<Uint8Array | null>,
  mask: (shown: boolean) => void = () => {},
): Promise<string> => {
  let input: number[] = []
  let escape = ''
  let pasted = false
  let shown = false
  let text = () => new TextDecoder().decode(new Uint8Array(input)).trim()
  for (;;) {
    let chunk = await read()
    if (!chunk) return text()
    for (let byte of chunk) {
      if (escape) {
        escape += String.fromCharCode(byte)
        if (escape == START || escape == END) {
          pasted = escape == START
          escape = ''
        } else if (!START.startsWith(escape) && !END.startsWith(escape)) {
          escape = ''
        }
        continue
      }
      if (byte == 27) {
        escape = '\x1b'
        continue
      }
      if (byte == 3) throw new Refused('Authorization cancelled')
      if (byte == 10 || byte == 13) {
        if (!pasted) return text()
        continue
      }
      if (byte == 8 || byte == 127) {
        input.pop()
        if (!input.length && shown) mask(shown = false)
        continue
      }
      if (byte < 32) continue
      input.push(byte)
      if (input.length > 16384) throw new Refused('Return URL is too long')
      if (!shown) mask(shown = true)
    }
  }
}

let hidden: AuthIO['hidden'] = async (signal, onEnd) => {
  signal?.throwIfAborted()
  let bytes = new Uint8Array(1024)
  let raw = system.stdin.isTerminal()
  let ended = false
  if (raw) system.stdin.setRaw(true)
  try {
    if (raw) system.stderr.writeSync(new TextEncoder().encode('\x1b[?2004h'))
    let line = await readHidden(
      async () => {
        let n = await system.stdin.read(bytes, signal)
        ended = n == null
        return n == null ? null : bytes.subarray(0, n)
      },
      (shown) =>
        system.stderr.writeSync(
          new TextEncoder().encode(shown ? '****' : '\b\b\b\b    \b\b\b\b'),
        ),
    )
    if (ended && !line) onEnd?.()
    return line
  } finally {
    if (raw) {
      system.stdin.setRaw(false)
      system.stderr.writeSync(new TextEncoder().encode('\x1b[?2004l\n'))
    }
  }
}

export let authIO: AuthIO = {
  say: (line) => console.error(line),
  hidden,
  listen,
}

let prompt = (io: AuthIO, waiting: boolean) =>
  io.say(
    waiting
      ? 'If the browser cannot reach this terminal, paste the whole return address and press Enter (input hidden).'
      : "Paste the browser's whole return address and press Enter (input hidden):",
  )

type Arrival = { callback: string; respond?: BrowserReturn['respond'] } | {
  error: unknown
}

let finish = async (
  auth: Authorization,
  name: string,
  begun: AuthReply & { url: string },
  io: AuthIO,
  as?: string,
) => {
  let input = new AbortController()
  let arrived: Arrival[] = []
  let ready = resolvers<void>()
  let accept = (value: Arrival) => {
    if (input.signal.aborted) return
    arrived.push(value)
    ready.resolve()
  }
  let state = name == 'yaks.app' && begun.redirectUrl == REDIRECT && io.listen
    ? new URL(begun.url).searchParams.get('state')
    : null
  let close = state && io.listen
    ? await loopback(new URL(REDIRECT), state, io.listen, accept)
    : undefined
  let read = async () => {
    let ended = false
    try {
      let callback = await io.hidden(input.signal, () => ended = true)
      if (!ended || !close) accept({ callback })
    } catch (error) {
      accept({ error })
    }
  }
  try {
    io.say(`Open ${begun.url} and sign in.`)
    prompt(io, !!close)
    void read()
    for (;;) {
      await ready.promise
      let back = arrived.shift()!
      if (!arrived.length) ready = resolvers<void>()
      if ('error' in back) throw back.error
      if (!back.callback) throw new Refused('Authorization cancelled')
      try {
        let reply = await auth.run('complete', name, back.callback, as)
        back.respond?.(true)
        return reply.message ?? 'Connected.'
      } catch (error) {
        back.respond?.(false)
        if (
          !(error instanceof OAuthError) ||
          !['callback', 'state', 'issuer', 'code'].includes(error.code)
        ) throw error
        io.say(
          `${error.message}. Try signing in or pasting the return address again.`,
        )
        if (!back.respond) {
          prompt(io, !!close)
          void read()
        }
      }
    }
  } finally {
    input.abort()
    await close?.()
  }
}

/** List available targets, or authorize one without storing the callback. */
export let authorizeCLI = async (
  auth: Authorization,
  name?: string,
  io: AuthIO = authIO,
  as?: string,
): Promise<string> => {
  try {
    if (!name) {
      let listed = await auth.run('list')
      let servers = listed.servers ?? []
      return [
        ...servers,
        ...(listed.message ? [listed.message] : []),
        ...(servers.length ? ['', 'sign in to one with: yak auth <name>'] : []),
      ].join('\n') || 'No connections to authorize.'
    }
    let begun = await auth.run('begin', name, undefined, as)
    if (!begun.url) throw new Error('Authorization returned no link')
    if (auth.returned?.(name)) {
      let reply = await auth.run('complete', name, undefined, as)
      return reply.message ?? 'Connected.'
    }
    return await finish(auth, name, { ...begun, url: begun.url }, io, as)
  } finally {
    await auth.close()
  }
}
