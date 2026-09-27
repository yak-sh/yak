// The native harness borrows Codex's current sign-in. Codex owns its auth file
// and refresh-token rotation; its app-server refreshes that file when the
// Responses endpoint rejects a bearer. Nothing here stores or prints a token.

import {
  CODEX,
  type Credential,
  source,
  type TransportCredential,
} from '@yaks/openai'

type Env = (name: string) => string | undefined
type Read = (path: string) => Promise<string>

let rotate = async (home: string): Promise<void> => {
  let child = new Deno.Command('codex', {
    args: ['app-server'],
    env: { CODEX_HOME: home },
    stdin: 'piped',
    stdout: 'piped',
    stderr: 'null',
  }).spawn()
  let writer = child.stdin.getWriter()
  let reader = child.stdout.getReader()
  let encoder = new TextEncoder(), decoder = new TextDecoder()
  let buffer = ''
  let timer = setTimeout(() => {
    try {
      child.kill()
    } catch { /* already ended */ }
  }, 30_000)
  let send = (value: unknown) =>
    writer.write(encoder.encode(JSON.stringify(value) + '\n'))
  let reply = async (id: number): Promise<Record<string, unknown>> => {
    for (;;) {
      let end = buffer.indexOf('\n')
      if (end < 0) {
        let next = await reader.read()
        if (next.done) throw new Error('Codex app-server closed during refresh')
        buffer += decoder.decode(next.value, { stream: true })
        continue
      }
      let line = buffer.slice(0, end)
      buffer = buffer.slice(end + 1)
      let message = JSON.parse(line) as Record<string, unknown>
      if (message.id == id) return message
    }
  }
  try {
    await send({
      method: 'initialize',
      id: 0,
      params: {
        clientInfo: {
          name: 'yaks_harness',
          title: 'Yaks Harness',
          version: '1.0.0',
        },
      },
    })
    if (!(await reply(0)).result) throw new Error('Codex initialization failed')
    await send({ method: 'initialized', params: {} })
    await send({
      method: 'account/read',
      id: 1,
      params: { refreshToken: true },
    })
    if (!(await reply(1)).result) {
      throw new Error('Codex could not refresh its sign-in; run codex login')
    }
  } finally {
    clearTimeout(timer)
    await writer.close().catch(() => {})
    await reader.cancel().catch(() => {})
    try {
      child.kill()
    } catch { /* already ended */ }
    await child.status
  }
}

/** Get the bearer Codex rotates, and refresh it once on a 401. */
export let codex = (
  env: Env,
  read: Read,
  renew: (home: string) => Promise<void> = rotate,
) => {
  let pending: Promise<void> | undefined
  return {
    credential: async (): Promise<Credential> => (await source(env, read)).cred,
    refresh: async (stale: TransportCredential): Promise<Credential> => {
      let now = await source(env, read)
      if (
        now.cred.token != stale.token || now.cred.base != CODEX ||
        !now.path
      ) return now.cred
      let home = now.path.slice(0, -'/auth.json'.length)
      if (!pending) {
        pending = renew(home).finally(() => pending = undefined)
      }
      await pending
      let next = (await source(env, read)).cred
      if (next.token == stale.token) {
        throw new Error('Codex did not rotate its credential; run codex login')
      }
      return next
    },
  }
}
