import * as system from '@yaks/process/system'
// A command line authorizes one connection in one process. The return URL is
// read with terminal echo off, never passed as a tool argument or graph data.

import { Refused } from '@yaks/graph/errors'
import { OAuthError } from '@yaks/oauth'
import type { Authorization } from './authorize.ts'
export type { Authorization } from './authorize.ts'

export type AuthIO = {
  say: (line: string) => void
  hidden: () => Promise<string>
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

let hidden = async (): Promise<string> => {
  let bytes = new Uint8Array(1024)
  let raw = system.stdin.isTerminal()
  if (raw) {
    system.stdin.setRaw(true)
    system.stderr.writeSync(new TextEncoder().encode('\x1b[?2004h'))
  }
  try {
    return await readHidden(
      async () => {
        let n = await system.stdin.read(bytes)
        return n == null ? null : bytes.subarray(0, n)
      },
      (shown) =>
        system.stderr.writeSync(
          new TextEncoder().encode(shown ? '****' : '\b\b\b\b    \b\b\b\b'),
        ),
    )
  } finally {
    if (raw) {
      system.stderr.writeSync(new TextEncoder().encode('\x1b[?2004l\n'))
      system.stdin.setRaw(false)
    }
  }
}

export let authIO: AuthIO = {
  say: (line) => console.error(line),
  hidden,
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
    io.say(`Open ${begun.url}`)
    io.say(
      'and sign in. The browser then lands on a localhost page that does not load: that is expected.',
    )
    for (;;) {
      io.say(
        "Paste that page's whole address, from the browser's address bar, and press Enter (input hidden):",
      )
      let callback = await io.hidden()
      if (!callback) throw new Refused('Authorization cancelled')
      try {
        let reply = await auth.run('complete', name, callback, as)
        return reply.message ?? 'Connected.'
      } catch (error) {
        if (
          !(error instanceof OAuthError) ||
          !['callback', 'state', 'issuer', 'code'].includes(error.code)
        ) throw error
        io.say(`${error.message}. Try the paste again.`)
      }
    }
  } finally {
    await auth.close()
  }
}
