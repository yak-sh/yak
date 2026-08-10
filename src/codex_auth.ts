// Bootstrap ownership of Codex's existing ChatGPT credential. The provider
// transport receives fresh in-memory tokens; callers receive only fixed
// failures. Refresh is serialized through Codex app-server, which owns the
// cache format and atomic token rotation.
import { type CredentialSource } from './responses.ts'

export type CodexAuthOptions = {
  path?: string
  read?: (path: string) => Promise<string>
  refresh?: () => Promise<void>
}

let path = () => {
  let home = Deno.env.get('CODEX_HOME')
  if (home) return `${home}/auth.json`
  let owner = Deno.env.get('HOME')
  if (!owner) throw new Error('codex credential unavailable')
  return `${owner}/.codex/auth.json`
}

let record = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value == 'object' && !Array.isArray(value)

let readCredential = async (
  file: string,
  read: (path: string) => Promise<string>,
) => {
  try {
    let value: unknown = JSON.parse(await read(file))
    if (!record(value) || !record(value.tokens)) throw new Error()
    let token = value.tokens.access_token
    let account = value.tokens.account_id
    if (typeof token != 'string' || !token) throw new Error()
    return {
      token,
      ...typeof account == 'string' && account ? { account } : {},
    }
  } catch {
    throw new Error('codex credential unavailable')
  }
}

let appRefresh = async () => {
  let home = Deno.env.get('HOME') ?? ''
  let env = {
    HOME: home,
    PATH: Deno.env.get('PATH') ?? '/usr/local/bin:/usr/bin:/bin',
    ...(Deno.env.get('CODEX_HOME')
      ? { CODEX_HOME: Deno.env.get('CODEX_HOME')! }
      : {}),
  }
  let child = new Deno.Command('codex', {
    args: ['app-server'],
    clearEnv: true,
    env,
    stdin: 'piped',
    stdout: 'piped',
    stderr: 'null',
  }).spawn()
  let writer = child.stdin.getWriter()
  let send = async (value: unknown) =>
    await writer.write(new TextEncoder().encode(`${JSON.stringify(value)}\n`))
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await send({
      method: 'initialize',
      id: 0,
      params: {
        clientInfo: {
          name: 'tasks',
          title: 'Tasks',
          version: '0.1.0',
        },
      },
    })
    await send({ method: 'initialized', params: {} })
    await send({
      method: 'account/read',
      id: 1,
      params: { refreshToken: true },
    })
    let response = (async () => {
      let decoder = new TextDecoder()
      let pending = ''
      for await (let bytes of child.stdout) {
        pending += decoder.decode(bytes, { stream: true })
        let lines = pending.split('\n')
        pending = lines.pop() ?? ''
        for (let line of lines) {
          let value: unknown
          try {
            value = JSON.parse(line)
          } catch {
            continue
          }
          if (!record(value) || value.id != 1) continue
          if (value.error || !record(value.result)) throw new Error()
          return
        }
      }
      throw new Error()
    })()
    await Promise.race([
      response,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error()), 30_000)
      }),
    ])
  } catch {
    throw new Error('codex credential refresh failed')
  } finally {
    if (timer != null) clearTimeout(timer)
    await writer.close().catch(() => {})
    try {
      child.kill('SIGTERM')
    } catch { /* it already exited */ }
    await child.status.catch(() => {})
  }
}

export let codexCredentials = (
  options: CodexAuthOptions = {},
): CredentialSource => {
  let file = options.path ?? path()
  let read = options.read ?? Deno.readTextFile
  let rotate = options.refresh ?? appRefresh
  let flight: Promise<void> | undefined
  let refresh = async () => {
    flight ??= rotate().finally(() => flight = undefined)
    await flight
    return await readCredential(file, read)
  }
  return {
    get: () => readCredential(file, read),
    refresh,
  }
}
