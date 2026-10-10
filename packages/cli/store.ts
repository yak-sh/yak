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

import type { VocabDoc } from '@yaks/vocab'
import type { Listed } from './tool.ts'

/** The tools a host served, and the version stamp of that list — and the
 * vocabulary its answers are drawn with, once one needed drawing
 * (platform.ts `vocabOf`), dropped with the list it came beside. */
export type Roster = {
  version?: string
  protocol?: string
  tools: Listed[]
  vocab?: VocabDoc
}

/** Where a variable is read from: this process's environment by default, or
 * a function a test passes so it never sets one every other test shares. */
export type Env = (name: string) => string | undefined

let env: Env = (name) => {
  try {
    return Deno.env.get(name)
  } catch {
    return undefined
  }
}

/** Where this operating system keeps a program's configuration. */
export let configDir = (vars: Env = env): string => {
  let home = vars('HOME') ?? vars('USERPROFILE') ?? '.'
  if (Deno.build.os == 'windows') {
    return vars('APPDATA') ?? `${home}/AppData/Roaming`
  }
  if (Deno.build.os == 'darwin') return `${home}/Library/Preferences`
  return vars('XDG_CONFIG_HOME') ?? `${home}/.config`
}

/** This program's own directory under it. */
export let stateDir = (vars: Env = env): string =>
  vars('YAKS_HOME') ?? `${configDir(vars)}/yaks`

let read = (path: string): Record<string, unknown> => {
  try {
    return JSON.parse(Deno.readTextFileSync(path))
  } catch {
    return {}
  }
}

let write = (dir: string, path: string, body: unknown, secret = false) => {
  Deno.mkdirSync(dir, { recursive: true, mode: 0o700 })
  Deno.writeTextFileSync(path, JSON.stringify(body, null, 2) + '\n', {
    mode: secret ? 0o600 : 0o644,
  })
  // The mode above only applies to a file this call created; an existing file
  // keeps whatever mode it had until it is changed explicitly.
  if (secret && Deno.build.os != 'windows') Deno.chmodSync(path, 0o600)
}

// Each host has its own file: reading one roster never parses every other
// server's tools and vocabulary. The filename holds no host text or secret.
let rosterPath = async (host: string, dir: string): Promise<string> => {
  let bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(host),
  )
  let key = [...new Uint8Array(bytes)].map((b) =>
    b.toString(16).padStart(2, '0')
  )
    .join('')
  return `${dir}/tools/${key}.json`
}
let saved = (dir: string, path: string, roster: unknown, fresh = false) => {
  let temp = `${path}.${crypto.randomUUID()}`
  try {
    write(`${dir}/tools`, temp, roster)
    if (!fresh) Deno.renameSync(temp, path)
    else {
      try {
        Deno.linkSync(temp, path)
      } catch (e) {
        if (!(e instanceof Deno.errors.AlreadyExists)) throw e
      }
    }
  } finally {
    try {
      Deno.removeSync(temp)
    } catch (e) {
      if (!(e instanceof Deno.errors.NotFound)) throw e
    }
  }
}
// Move every old cache entry once. Existing destinations win after an
// interrupted move; only a completed move removes the source.
let migrated = async (dir: string): Promise<void> => {
  let legacy = `${dir}/tools.json`
  try {
    Deno.statSync(legacy)
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return
    throw e
  }
  for (let [host, roster] of Object.entries(read(legacy))) {
    let path = await rosterPath(host, dir)
    try {
      Deno.statSync(path)
    } catch (e) {
      if (!(e instanceof Deno.errors.NotFound)) throw e
      saved(dir, path, roster, true)
    }
  }
  try {
    Deno.removeSync(legacy)
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e
  }
}

export { accountToken as tokenFor } from './accounts.ts'

/** The cached tool list for a host, if there is one. */
export let cached = async (
  host: string,
  dir: string = stateDir(),
): Promise<Roster | null> => {
  await migrated(dir)
  let kept = read(await rosterPath(host, dir))
  return Array.isArray(kept.tools) ? kept as Roster : null
}

/** Cache one. */
export let remember = async (
  host: string,
  roster: Roster,
  dir: string = stateDir(),
): Promise<void> => {
  await migrated(dir)
  saved(dir, await rosterPath(host, dir), roster)
}

/** Drop one — the tool list changed, so the next command calls `tools/list`
 * again. */
export let forget = async (
  host: string,
  dir: string = stateDir(),
): Promise<void> => {
  await migrated(dir)
  try {
    Deno.removeSync(await rosterPath(host, dir))
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e
  }
}
