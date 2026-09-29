// A citation of a graph entity keeps the content it was checked against.
// The hash ignores server-owned stamps, so bookkeeping cannot make a claim
// stale. File and symbol citations have a narrower answer in @yaks/git.

import { cmp } from '@yaks/fp'
import { type Bundle, type Comp, comps, Refused, sha256 } from '@yaks/graph'
import type { Vocab } from '@yaks/vocab'

export let CITES = 'cites'

let written = (c: Comp, props: string[]): Comp => {
  let out: Comp = {}
  for (let p of props.toSorted()) if (c[p] != null) out[p] = c[p]
  return out
}

/** SHA-256 over an entity's client-written properties, in a fixed order. */
export let content = (vocab: Vocab) => (b: Bundle): string => {
  let kept: [string, Comp][] = []
  for (let [name, c] of comps(b)) {
    let info = vocab.comp(name)
    if (!c || !info?.wire) continue
    if (!info.writable.length && info.stamped.length) continue
    kept.push([name, written(c, info.writable)])
  }
  kept.sort(([a], [b]) => cmp(a, b))
  return sha256(JSON.stringify(kept))
}

export type Status =
  | { state: 'current' }
  | { state: 'moved'; changes?: string[] }
  | { state: 'unverified' }
  | { state: 'unknown'; why: string }

/** Whether the cited entity still says what was verified. */
export let status = (cite: Bundle, to: Bundle, vocab: Vocab): Status => {
  if (!cite.verified) return { state: 'unverified' }
  if (to.tombstone) return { state: 'moved' }
  let row = cite[CITES]
  let hash = row && typeof row == 'object' && 'hash' in row
    ? row.hash
    : undefined
  if (typeof hash != 'string' || !hash) {
    return { state: 'unknown', why: 'verified against no content hash' }
  }
  return hash == content(vocab)(to) ? { state: 'current' } : {
    state: 'moved',
  }
}

/** The patch recording that somebody checked this citation's target. */
export let verify = (cite: Bundle, to: Bundle, vocab: Vocab): Bundle => {
  if (to.tombstone) throw new Refused('cannot verify a deleted entity')
  return {
    entity: { eid: cite.entity.eid },
    verified: {},
    [CITES]: { hash: content(vocab)(to) },
  }
}
