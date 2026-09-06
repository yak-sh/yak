// What this box remembers between commands: the bearer a `yaks login` wrote,
// and the tool list a host last served.
//
// Two files, not one, and the reason is the difference between them. The token
// is a secret and lives at 0600 in a directory of its own at 0700; the cache is
// a copy of something the server says to anyone who asks. Keeping them apart
// means no widening of the cache can ever widen the token, and a cache that has
// to be deleted takes nothing with it.
//
// The cache is keyed by host and stamped with the ROSTER VERSION (T-34277) —
// the eight hex characters `about` names its list by. Nothing here checks that
// version: checking would cost the round trip the cache exists to save. It is
// dropped instead on the two signals that arrive for free — a result carrying
// the roster line, and an `about` naming a different version.

import type { Tool } from './tool.ts'

/** The tools a host served, and the name of that list. */
export type Roster = {
  version?: string
  protocol?: string
  tools: Tool[]
}

let env = (name: string): string | undefined => {
  try {
    return Deno.env.get(name)
  } catch {
    return undefined
  }
}

/** Where this OS keeps a program's configuration. */
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
  // The mode above only lands on a file this call created; an older one keeps
  // whatever it had until it is told.
  if (secret && Deno.build.os != 'windows') Deno.chmodSync(path, 0o600)
}

let tokensPath = (): string => `${stateDir()}/token.json`
let rostersPath = (): string => `${stateDir()}/tools.json`

/** The bearer for a host: the environment first, so a sandbox that sets
 * `YAKS_TOKEN` never has a file to write. */
export let tokenFor = (host: string): string | null => {
  let said = env('YAKS_TOKEN')
  if (said) return said
  let kept = read(tokensPath())[host]
  return typeof kept == 'string' ? kept : null
}

/** Remember a bearer for a host, readable by nobody else. */
export let saveToken = (host: string, token: string): string => {
  let path = tokensPath()
  write(path, { ...read(path), [host]: token }, true)
  return path
}

/** Forget it. */
export let forgetToken = (host: string): void => {
  let path = tokensPath()
  let kept = read(path)
  delete kept[host]
  write(path, kept, true)
}

/** The tool list this box has for a host, if any. */
export let cached = (host: string): Roster | null => {
  let kept = read(rostersPath())[host]
  return kept && typeof kept == 'object' ? kept as Roster : null
}

/** Keep one. */
export let remember = (host: string, roster: Roster): void => {
  let path = rostersPath()
  write(path, { ...read(path), [host]: roster })
}

/** Drop one — the tool list moved, so the next command lists again. */
export let forget = (host: string): void => {
  let path = rostersPath()
  let kept = read(path)
  delete kept[host]
  write(path, kept)
}
