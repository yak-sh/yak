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
import { sha256 } from '@yaks/graph/sha256'
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

/** The filesystem operations roster persistence needs. The migration and
 * per-host cache use the same operations on a disk or an in-memory filesystem. */
export type RosterFiles = {
  readTextFileSync: (path: string) => string
  mkdirSync: (path: string, options: Deno.MkdirOptions) => void
  writeTextFileSync: (
    path: string,
    body: string,
    options: Deno.WriteFileOptions,
  ) => void
  renameSync: (from: string, to: string) => void
  linkSync: (from: string, to: string) => void
  removeSync: (path: string) => void
  statSync: (path: string) => unknown
}

/** A roster cache over a filesystem. Destinations survive a retried migration,
 * and a forgotten host cannot return from the legacy combined file. */
/** Where each host's roster is kept between commands. */
export type Rosters = {
  cached: (host: string, dir?: string) => Promise<Roster | null>
  remember: (host: string, roster: Roster, dir?: string) => Promise<void>
  forget: (host: string, dir?: string) => Promise<void>
}

export let rosters = (files: RosterFiles = Deno): Rosters => {
  let read = (path: string): Record<string, unknown> => {
    try {
      return JSON.parse(files.readTextFileSync(path))
    } catch {
      return {}
    }
  }
  let write = (dir: string, path: string, body: unknown) => {
    files.mkdirSync(dir, { recursive: true, mode: 0o700 })
    files.writeTextFileSync(path, JSON.stringify(body, null, 2) + '\n', {
      mode: 0o644,
    })
  }

  // Each host has its own file: reading one roster never parses every other
  // server's tools and vocabulary. The filename holds no host text or secret.
  let rosterPath = (host: string, dir: string): string =>
    `${dir}/tools/${sha256(host)}.json`
  // A file removed, or already gone.
  let gone = (path: string) => {
    try {
      files.removeSync(path)
    } catch (e) {
      if (!(e instanceof Deno.errors.NotFound)) throw e
    }
  }
  let saved = (dir: string, path: string, roster: unknown, fresh = false) => {
    let temp = `${path}.${crypto.randomUUID()}`
    try {
      write(`${dir}/tools`, temp, roster)
      if (!fresh) files.renameSync(temp, path)
      else {
        try {
          files.linkSync(temp, path)
        } catch (e) {
          if (!(e instanceof Deno.errors.AlreadyExists)) throw e
        }
      }
    } finally {
      gone(temp)
    }
  }
  // Move every old cache entry once. Existing destinations win after an
  // interrupted move; only a completed move removes the source.
  let migrated = (dir: string): void => {
    let legacy = `${dir}/tools.json`
    try {
      files.statSync(legacy)
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) return
      throw e
    }
    for (let [host, roster] of Object.entries(read(legacy))) {
      let path = rosterPath(host, dir)
      try {
        files.statSync(path)
      } catch (e) {
        if (!(e instanceof Deno.errors.NotFound)) throw e
        saved(dir, path, roster, true)
      }
    }
    try {
      files.removeSync(legacy)
    } catch (e) {
      if (!(e instanceof Deno.errors.NotFound)) throw e
    }
  }

  /** The cached tool list for a host, if there is one. */
  let cached = async (
    host: string,
    dir: string = stateDir(),
  ): Promise<Roster | null> => {
    await migrated(dir)
    let kept = read(rosterPath(host, dir))
    return Array.isArray(kept.tools) ? kept as Roster : null
  }

  /** Cache one. */
  let remember = async (
    host: string,
    roster: Roster,
    dir: string = stateDir(),
  ): Promise<void> => {
    await migrated(dir)
    saved(dir, rosterPath(host, dir), roster)
  }

  /** Drop one — the tool list changed, so the next command calls `tools/list`
   * again. */
  let forget = async (
    host: string,
    dir: string = stateDir(),
  ): Promise<void> => {
    await migrated(dir)
    try {
      files.removeSync(rosterPath(host, dir))
    } catch (e) {
      if (!(e instanceof Deno.errors.NotFound)) throw e
    }
  }
  return { cached, remember, forget }
}

export { accountToken as tokenFor } from './accounts.ts'
let roster: Rosters = rosters()
export let cached: Rosters['cached'] = roster.cached
export let remember: Rosters['remember'] = roster.remember
export let forget: Rosters['forget'] = roster.forget
