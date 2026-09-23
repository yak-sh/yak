// A vault on a box: one private file per secret in a directory of its own.
//
// The directory sits beside the graph's database and never inside it
// (./rules.ts `vaultFor`), so the database, its journal, its backups and the
// text dump a backup commits hold only sentinels. The discipline is the one a
// credential file on a shared machine needs: the directory is 0700, every file
// 0600, a write is a temporary file renamed over the old one so a reader never
// sees half a secret, and a symlink anywhere is refused rather than followed —
// the vault is exactly the files it wrote.
//
// One file per secret, rather than one file of all of them, so two processes
// sealing two secrets never write the same file, and deleting a secret is
// deleting its file. Deleting cannot promise the bytes are gone from the disk,
// a snapshot or a host backup; it promises nothing here names them.

import type { Eid } from '@yaks/graph'
import { type Local, queue, type Sealed } from './vault.ts'

// A secret's id is derived from its name, so it is always a uuid. Anything
// else never came from this vault, and is never turned into a path.
let OURS = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

let lstat = (path: string): Deno.FileInfo | null => {
  try {
    return Deno.lstatSync(path)
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return null
    throw e
  }
}

let refuse = (path: string) => {
  throw new Error(`${path} is not a vault's own file: refusing to follow it`)
}

// The directory, made private — or refused, where something other than the
// directory this vault made is standing there.
let own = (dir: string): void => {
  let at = lstat(dir)
  if (at && (at.isSymlink || !at.isDirectory)) refuse(dir)
  if (!at) Deno.mkdirSync(dir, { recursive: true, mode: 0o700 })
  Deno.chmodSync(dir, 0o700)
}

let readIn = (path: string): string | undefined => {
  let at = lstat(path)
  if (!at) return undefined
  if (at.isSymlink || !at.isFile) refuse(path)
  return Deno.readTextFileSync(path)
}

let writeIn = (dir: string, path: string, text: string): void => {
  own(dir)
  let at = lstat(path)
  if (at && (at.isSymlink || !at.isFile)) refuse(path)
  let temp = `${path}.${crypto.randomUUID()}.tmp`
  try {
    Deno.writeTextFileSync(temp, text, { createNew: true, mode: 0o600 })
    Deno.chmodSync(temp, 0o600)
    Deno.renameSync(temp, path)
  } catch (e) {
    try {
      Deno.removeSync(temp)
    } catch { /* never written */ }
    throw e
  }
}

let unhex = (hex: string) =>
  new Uint8Array(hex.match(/../g)!.map((b) => parseInt(b, 16)))
let hex = (bytes: Uint8Array) =>
  [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')

/** The vault in a directory: `<dir>/<eid>.json` per secret, and `<dir>/salt`,
 * the key its sentinels are hashed under, made the first time one is. */
export let fileVault = (dir: string): Local => {
  let file = (eid: Eid) => `${dir}/${eid}.json`
  let held = queue()
  let salt: Uint8Array | undefined
  return {
    salt: () => {
      if (salt) return salt
      let said = readIn(`${dir}/salt`)?.trim()
      if (said) return salt = unhex(said)
      salt = crypto.getRandomValues(new Uint8Array(32))
      writeIn(dir, `${dir}/salt`, hex(salt) + '\n')
      return salt
    },
    read: (eid) => {
      if (!OURS.test(eid)) return undefined
      let text = readIn(file(eid))
      return text ? JSON.parse(text) as Sealed : undefined
    },
    seal: (eid, sealed) => {
      if (!OURS.test(eid)) throw new Error(`not a secret's id: ${eid}`)
      writeIn(dir, file(eid), JSON.stringify(sealed) + '\n')
    },
    drop: (eid) => {
      if (!OURS.test(eid) || !lstat(file(eid))) return
      Deno.removeSync(file(eid))
    },
    all: () => {
      if (!lstat(dir)) return []
      let out: [Eid, Sealed][] = []
      for (let e of Deno.readDirSync(dir)) {
        let eid = e.name.replace(/\.json$/, '')
        if (e.name == eid || !OURS.test(eid)) continue
        let text = readIn(file(eid))
        if (text) out.push([eid, JSON.parse(text)])
      }
      return out
    },
    // The other writers in this process wait in the queue; the other
    // processes on the box wait on the lock file.
    lock: (eid, fn) =>
      held(eid, async () => {
        if (!OURS.test(eid)) throw new Error(`not a secret's id: ${eid}`)
        own(dir)
        using lock = await Deno.open(`${dir}/${eid}.lock`, {
          create: true,
          write: true,
          mode: 0o600,
        })
        await lock.lock(true)
        return await fn()
      }),
  }
}
