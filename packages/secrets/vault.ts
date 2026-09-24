// Where a secret's value is kept: a vault. The graph holds the name and the
// handle; the vault holds what the handle stands for, keyed by the secret's
// entity id, and the salt a handle is hashed under to make its sentinel.
//
// A vault is the one thing that differs between the places a graph runs, so
// this package keeps none but memory (below), for a test or a graph that lasts
// as long as its process. A vault that stores somewhere lives with that
// storage and meets this shape: a directory of private files on a box
// (@yaks/cli), a D1 database on yaks.app (@yaks/d1). The plugin, the reveal and
// the records store are written against this type alone, and every method may
// answer now or later, so a vault that has to ask a network is as good as one
// that reads a file.

import type { Eid } from '@yaks/graph'

/** What a vault keeps for one secret: the handle the graph holds for it, and
 * the value — or, for a value that lives in 1Password, the `op://` reference
 * it is read from at the moment it is used. */
export type Sealed = {
  /** the secret's name, where the write carried it */
  name?: string
  handle: string
  value?: string
  op?: string
}

type Maybe<T> = T | Promise<T>

/** A place to keep secrets. */
export type Vault = {
  /** the key every sentinel this vault hands out is hashed under
   * (./sentinel.ts) */
  salt: () => Maybe<Uint8Array>
  read: (eid: Eid) => Maybe<Sealed | undefined>
  seal: (eid: Eid, sealed: Sealed) => Maybe<void>
  drop: (eid: Eid) => Maybe<void>
  /** every secret it keeps, by entity id */
  all: () => Maybe<[Eid, Sealed][]>
  /** run `fn` with this secret held against every other writer — the other
   * callers in this process, and on a box the other processes too — so a
   * read, a change and the write back are one step */
  lock: <T>(eid: Eid, fn: () => Promise<T>) => Promise<T>
}

/** A vault that answers at once: what a config read on the spot needs
 * (./reveal.ts `peek`). A box's files and memory are both this. */
export type Local = Omit<Vault, 'read' | 'all'> & {
  read: (eid: Eid) => Sealed | undefined
  all: () => [Eid, Sealed][]
}

/** One lock per key, within this process: each caller waits for the one
 * before it. */
export let queue = (): Vault['lock'] => {
  let tails = new Map<string, Promise<unknown>>()
  return <T>(key: string, fn: () => Promise<T>): Promise<T> => {
    let run = (tails.get(key) ?? Promise.resolve()).then(fn, fn)
    let tail = run.catch(() => {})
    tails.set(key, tail)
    tail.then(() => tails.get(key) == tail && tails.delete(key))
    return run
  }
}

/** A vault in memory: its secrets last as long as the process, which is right
 * for a graph that does too, and for a test. */
export let ramVault = (): Local => {
  let kept = new Map<Eid, Sealed>()
  let salt = crypto.getRandomValues(new Uint8Array(32))
  return {
    salt: () => salt,
    read: (eid) => kept.get(eid),
    seal: (eid, sealed) => void kept.set(eid, sealed),
    drop: (eid) => void kept.delete(eid),
    all: () => [...kept],
    lock: queue(),
  }
}
