// Shared test fixtures (not part of the published package — see deno.json): a
// book club that writes to its members.
//
// The club is a `space`, its people are `person` entities wearing an `email`,
// and its roster is a `member` row — the same three words @yaks/member ships,
// declared here so this package's tests need no dependency on it. The store is
// @yaks/ram: a Map holding the bundles, the same apply() and the same
// queries as a database.

import { type Graph, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { type Effects, effects } from '@yaks/effects'
import { loadVocab, type Vocab, type VocabDoc } from '@yaks/vocab'
import { docDoc, docs } from '@yaks/doc'
import { mailDoc } from './comp.ts'
import { mailbox } from './plugin.ts'
import { type Stash, stash } from './stash.ts'

let doc: VocabDoc = {
  $defs: {
    entity: {
      type: 'object',
      wire: false,
      properties: { num: { type: 'number', stamped: true } },
    },
    space: { type: 'object', kind: true, properties: { name: {} } },
    person: { type: 'object', kind: true, properties: { name: {} } },
    // The roster row @yaks/member ships, said here so the invitation example
    // has something to be woken by.
    member: {
      type: 'object',
      kind: true,
      properties: {
        space: { type: 'string', ref: 'space', death: 'cascade' },
        person: {
          type: 'string',
          ref: 'person',
          death: 'cascade',
          bare: false,
        },
        role: { enum: ['owner', 'member'], default: 'member' },
      },
    },
    created: {
      type: 'object',
      properties: {
        at: { type: 'string', format: 'date-time', stamped: true },
      },
    },
    updated: {
      type: 'object',
      properties: {
        at: { type: 'string', format: 'date-time', stamped: true },
      },
    },
  },
}

/** The club's vocabulary: its own words, this package's, and the `doc` a
 * letter's subject and body live in. */
export let club: Vocab = loadVocab([docDoc, mailDoc, doc])

/** A clock that does not move, so a test can assert on `delivered.at`. */
export let noon = (): string => '2026-09-05T12:00:00.000Z'

/** The whole rig: a graph over a fresh Map, its effects, and the stash the
 * letters land in. */
export type Club = {
  /** the club's graph */
  g: Graph
  /** its effect registry, for a test that registers another handler */
  fx: Effects
  /** where the letters went */
  post: Stash
}

/** A club with a post room. `refuse` makes every send fail, for the bounce. */
export let clubhouse = (refuse?: string): Club => {
  // The write door the sending effect settles a letter through: the club's own
  // graph, trusted, since `delivered` and `bounced` are server-owned. `g` is
  // built below and this only ever runs post-commit.
  let fx = effects(club, { write: (b) => g.apply(b, { trusted: true }) })
  let post = stash(refuse ? { refuse } : {})
  let g = graph({
    storage: ram(club),
    vocab: club,
    plugins: [
      fx,
      docs(),
      mailbox({
        domain: 'books.example',
        sender: post,
        effects: fx,
        now: noon,
      }),
    ],
  })
  return { g, fx, post }
}
