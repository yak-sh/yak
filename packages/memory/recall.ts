// Getting them back. A recall answers memories whole — the sentence and its
// context, never a snippet — because half of what somebody said is worse than
// none of it. What is ranked is which ones, not how much of them.
//
// Several rankings, one result. Where the server has a vector service, a
// {@link Ranker} returns which memories are nearest in meaning to the words
// asked about ("how do they like the pages to look"), and this package never
// learns how that is done. A server whose store does the same thing answers
// `.near=<entity>` in the query string itself (@yaks/embedding), and
// {@link Asked.near} is where that goes. With neither, the words select:
// {@link line} builds a query string carrying the words, which every yaks store
// answers as a full-text search over `doc` — where a memory's sentence lives —
// and the newest of the selected rows come first, because a query string
// carries no bm25 score. None of this is configured; a caller that has a ranker
// passes one.

import type { Bundle, Comp, Eid } from '@yaks/graph'
import { MEMORY } from './comp.ts'

/** One memory, read back. */
export type Memory = {
  eid: Eid
  /** the person's own words */
  said: string
  /** the line or two needed to read them, or '' */
  context: string
  /** the app it was about, by slug, or '' */
  about: string
  /** who said it — the name where the store gave one, else their id */
  by: string
  /** when they said it, as the store stamped it */
  at: string
}

/**
 * The memories of a space nearest in meaning to some words, closest first —
 * ids only, since the store returns the memories themselves. A server with a
 * vector service supplies one; a server with none supplies nothing, and
 * {@link line} ranks by word matching instead.
 */
export type Ranker = (
  words: string,
  scope: { space: Eid; limit: number },
) => Promise<Eid[]>

let comp = (b: Bundle, name: string): Comp =>
  (b[name] && typeof b[name] == 'object' ? b[name] : {}) as Comp

let str = (v: unknown): string => typeof v == 'string' ? v : ''

// A byline reads back as the eid, or as `{eid, name}` where the store resolved
// the name; either way, what a passage wants is the name when there is one.
let who = (v: unknown): string =>
  v && typeof v == 'object'
    ? str((v as { name?: unknown; eid?: unknown }).name) ||
      str((v as { eid?: unknown }).eid)
    : str(v)

/** One bundle as a memory. */
export let heard = (b: Bundle): Memory => {
  let m = comp(b, MEMORY)
  let created = comp(b, 'created')
  return {
    eid: b.entity.eid,
    said: str(comp(b, 'doc').body),
    context: str(m.context),
    about: str(m.about),
    by: who(created.by),
    at: str(created.at),
  }
}

// The words, stripped of anything the query string cannot carry: its own
// punctuation (`&`, `=`, `.`) would be read as grammar, and a full-text index
// matches words anyway.
let words = (said: string) =>
  said.replace(/[^\p{L}\p{N}\s'-]+/gu, ' ').trim().replace(/\s+/g, ' ')

/** What a recall is looking for: which memories, and what ranks them. */
export type Asked = {
  /** at most this many */
  limit: number
  /** the space they were said in */
  space?: Eid
  /** the project they are scoped to */
  scope?: Eid
  /** only the ones recording a correction somebody gave */
  feedback?: boolean
  /** the words to select by — the store's own index over `doc` */
  said?: string
  /** an entity to rank by meaning instead, where the server has embeddings */
  near?: Eid
  /** particular ones, by id */
  eids?: Eid[]
}

/**
 * The query string that finds memories: with words, the memories containing
 * every one of them, which is what somebody searching means; with a `near`,
 * ranked by meaning; otherwise newest first. Words DO not rank: @yaks/fts
 * compiles a word into a condition and keeps its bm25 score for the search
 * tool, so a query string carrying words is a filter and the newest still come
 * first. The components are named so a returned row carries them — a row
 * carries only what its filter names.
 *
 * ```ts
 * line({ space: 's1', limit: 8 })
 * // '.memory.space=s1&.doc?&.created?&.order=-entity.num&.limit=8'
 * ```
 */
export let line = (asked: Asked): string => {
  let said = words(asked.said ?? '')
  let ranked = !!(asked.eids?.length || asked.near)
  return [
    ...(said ? [said] : []),
    ...(asked.eids?.length ? [`.eid=${asked.eids.join(',')}`] : []),
    ...(asked.near ? [`.near=${asked.near}`] : []),
    // A memory is what is being asked for, so the component is always in the
    // query; naming it with a space bounds the result and names it at once.
    asked.space ? `.${MEMORY}.space=${asked.space}` : `.${MEMORY}`,
    ...(asked.scope ? [`.${MEMORY}.scope=${asked.scope}`] : []),
    ...(asked.feedback ? ['.feedback'] : []),
    '.doc?',
    '.created?',
    ...(asked.near ? ['.order=similar'] : ranked ? [] : ['.order=-entity.num']),
    `.limit=${asked.limit}`,
  ].join('&')
}

/**
 * The memories a store returned, in the order a {@link Ranker} asked for. A
 * store returns a set; the ranking is the caller's, and an id the store did
 * not return (a memory since deleted) simply drops out.
 */
export let ordered = (ids: Eid[], held: Memory[]): Memory[] => {
  let by = new Map(held.map((m) => [m.eid, m]))
  return ids.flatMap((id) => {
    let m = by.get(id)
    return m ? [m] : []
  })
}
