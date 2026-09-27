// A command line authorizes one connection in one process. The return URL is
// read with terminal echo off, never passed as a tool argument or graph data.

import { Refused } from '@yaks/graph'
import type { MCPAuthAction, MCPAuthReply } from './mcp_auth.ts'

export type Authorization = {
  run: (
    action: MCPAuthAction,
    name?: string,
    callback?: string,
  ) => Promise<MCPAuthReply>
  close: () => Promise<void>
}

export type AuthIO = {
  say: (line: string) => void
  hidden: () => Promise<string>
}

let hidden = async (): Promise<string> => {
  let bytes = new Uint8Array(1024)
  let text = ''
  let raw = Deno.stdin.isTerminal()
  if (raw) Deno.stdin.setRaw(true)
  try {
    for (;;) {
      let n = await Deno.stdin.read(bytes)
      if (n == null) break
      for (let byte of bytes.subarray(0, n)) {
        if (byte == 3) throw new Refused('Authorization cancelled')
        if (byte == 10 || byte == 13) return text
        if (byte == 8 || byte == 127) text = text.slice(0, -1)
        else text += String.fromCharCode(byte)
        if (text.length > 16384) throw new Refused('Return URL is too long')
      }
    }
    return text
  } finally {
    if (raw) {
      Deno.stdin.setRaw(false)
      console.error()
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
): Promise<string> => {
  try {
    if (!name) {
      let listed = await auth.run('list')
      return [
        ...(listed.servers ?? []),
        ...(listed.message ? [listed.message] : []),
      ].join('\n') || 'No connections to authorize.'
    }
    let begun = await auth.run('begin', name)
    if (!begun.url) throw new Error('Authorization returned no link')
    io.say(`Open ${begun.url}`)
    io.say('Paste the complete return URL and press Enter (input hidden):')
    let callback = await io.hidden()
    if (!callback) throw new Refused('Authorization cancelled')
    let reply = await auth.run('complete', name, callback)
    return reply.message ?? 'Connected.'
  } finally {
    await auth.close()
  }
}
