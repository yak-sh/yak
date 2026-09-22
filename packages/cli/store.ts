// What this machine remembers between commands: the bearer token `yak login`
// saved, and the tool list a host last served.
//
// Two files, not one, and the reason is the difference between them. The token
// is a secret and is written 0600 in a directory of its own at 0700; the cache
// is a copy of something the server tells anyone who asks. Keeping them apart
// means loosening the cache's permissions can never loosen the token's, and a
// cache that has to be deleted takes nothing else with it.
//
// The cache is keyed by host and stamped with the roster version (T-34277) —
// the eight hex characters the `about` tool names its tool list by. Nothing
// here checks that version, because checking would cost the round trip the
// cache exists to save. The cache is dropped instead on the two signals that
// arrive for free — a tool result carrying the roster notice, and an `about`
// result naming a different version.

import type { Listed } from './tool.ts'

/** The tools a host served, and the version stamp of that list. */
export type Roster = {
  version?: string
  protocol?: string
  tools: Listed[]
}

let env = (name: string): string | undefined => {
  try {
    return Deno.env.get(name)
  } catch {
    return undefined
  }
}

/** Where this operating system keeps a program's configuration. */
export let configDir = (): string => {
  let home = env('HOME') ?? env('USERPROFILE') ?? '.'
  if (Deno.build.os == 'windows') {
    return env('APPDATA') ?? `${home}/AppData/Roaming`
  }
  if (Deno.build.os == 'darwin') return `${home}/Library/Preferences`
  return env('XDG_CONFIG_HOME') ?? `${home}/.config`
}

/** This program's own directory under it. */
export let stateDir = (): string => env('YAKS_HOME') ?? `${configDir()}/yaks`

let read = (path: string): Record<string, unknown> => {
  try {
    return JSON.parse(Deno.readTextFileSync(path))
  } catch {
    return {}
  }
}

let write = (path: string, body: unknown, secret = false) => {
  Deno.mkdirSync(stateDir(), { recursive: true, mode: 0o700 })
  Deno.writeTextFileSync(path, JSON.stringify(body, null, 2) + '\n', {
    mode: secret ? 0o600 : 0o644,
  })
  // The mode above only applies to a file this call created; an existing file
  // keeps whatever mode it had until it is changed explicitly.
  if (secret && Deno.build.os != 'windows') Deno.chmodSync(path, 0o600)
}

let tokensPath = (): string => `${stateDir()}/token.json`
let rostersPath = (): string => `${stateDir()}/tools.json`

/** The bearer token for a host: the environment first, so a sandbox that sets
 * `YAKS_TOKEN` never has to write a file. */
export let tokenFor = (host: string): string | null => {
  let said = env('YAKS_TOKEN')
  if (said) return said
  let kept = read(tokensPath())[host]
  return typeof kept == 'string' ? kept : null
}

/** Save a bearer token for a host, readable by nobody else. */
export let saveToken = (host: string, token: string): string => {
  let path = tokensPath()
  write(path, { ...read(path), [host]: token }, true)
  return path
}

/** Delete the saved bearer token for a host. */
export let forgetToken = (host: string): void => {
  let path = tokensPath()
  let kept = read(path)
  delete kept[host]
  write(path, kept, true)
}

/** The cached tool list for a host, if there is one. */
export let cached = (host: string): Roster | null => {
  let kept = read(rostersPath())[host]
  return kept && typeof kept == 'object' ? kept as Roster : null
}

/** Cache one. */
export let remember = (host: string, roster: Roster): void => {
  let path = rostersPath()
  write(path, { ...read(path), [host]: roster })
}

/** Drop one — the tool list changed, so the next command calls `tools/list`
 * again. */
export let forget = (host: string): void => {
  let path = rostersPath()
  let kept = read(path)
  delete kept[host]
  write(path, kept)
}
