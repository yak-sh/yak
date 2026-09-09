// A commit, as git writes one down: a tree, its parents, who wrote it, who
// recorded it, a blank line, and the message.
//
//   tree ac1c58…\n
//   parent 2b72ae…\n
//   author yaks <a6433884@users.yaks.app> 1757000000 +0000\n
//   committer yaks.app <git@yaks.app> 1757000000 +0000\n
//   \n
//   deploy 1\n
//
// The ids are HEX here, unlike a tree's raw bytes, and they are whichever name
// is being written — a SHA-256 commit names its tree and parents by their
// `oid256`.
//
// Two small fidelities. The offset is always `+0000`, because the time this
// package is given is an instant off the graph and not a place; and the message
// ends in exactly one newline, which is what `git commit-tree -m` writes, so a
// message that came back from a real repository round-trips to the same id.

import { concat } from './oid.ts'

/** One side of a commit's authorship: a name, an address, and when. `at` is
 * anything `Date` takes — an ISO string off the graph, or epoch millis. */
export type Who = { name: string; email: string; at: string | number | Date }

/** What a commit says, with every id in one flavour of name. */
export type Commit = {
  /** the root tree's id */
  tree: string
  /** the commits this one follows, in order */
  parents?: string[]
  /** who wrote the change */
  author: Who
  /** who recorded it — for us, the platform */
  committer: Who
  /** the message, newline-terminated on the way out */
  message: string
}

let utf8 = new TextEncoder()

// `<`, `>` and a newline are the format's own punctuation: git refuses them in
// an ident, so a name carrying one is trimmed rather than allowed to write a
// commit nobody can parse.
let ident = (s: string): string => s.replace(/[<>\n]/g, '').trim()

/** Whole seconds since the epoch — git's clock. */
export let seconds = (at: Who['at']): number =>
  Math.floor(new Date(at).getTime() / 1000)

/** One authorship line's value: `name <email> 1757000000 +0000`. */
export let signature = (who: Who): string =>
  `${ident(who.name)} <${ident(who.email)}> ${seconds(who.at)} +0000`

/**
 * The tree a commit body names, or nothing if these bytes are not a commit.
 *
 * The one link in this package no edge carries: a commit's parents are rows
 * (./comp.ts) because history is walked constantly, but its tree is written
 * only here, in the first line of the body the id was taken over — and a pack
 * reads the body anyway on its way out.
 */
export let treeOf = (body: Uint8Array): string | undefined => {
  let [word, id] = new TextDecoder().decode(body.subarray(0, 80))
    .split('\n')[0]
    .split(' ')
  return word == 'tree' && /^[0-9a-f]+$/.test(id ?? '') ? id : undefined
}

/** A commit object's body. */
export let commitBody = (c: Commit): Uint8Array<ArrayBuffer> => {
  let lines = [
    `tree ${c.tree}\n`,
    ...(c.parents ?? []).map((p) => `parent ${p}\n`),
    `author ${signature(c.author)}\n`,
    `committer ${signature(c.committer)}\n`,
    `\n`,
    c.message.replace(/\n*$/, '\n'),
  ]
  return concat(lines.map((l) => utf8.encode(l)))
}
