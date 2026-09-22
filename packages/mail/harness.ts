// Shared test fixtures (not part of the published package — see deno.json): a
// book club that writes to its members.
//
// The club is a `space`, its people are `person` entities carrying an `email`,
// and its roster is a `member` row — the same three components @yaks/member
// ships, declared here so this package's tests need no dependency on it. The
// store is @yaks/ram: a Map holding the bundles, with the same apply() and the
// same queries as a database.

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
      component: true,
      type: 'object',
      wire: false,
      properties: { num: { type: 'number', stamped: true } },
    },
    space: {
      component: true,
      type: 'object',
      kind: true,
      properties: { name: {} },
    },
    person: {
      component: true,
      type: 'object',
      kind: true,
      properties: { name: {} },
    },
    // The roster row @yaks/member ships, declared here so the invitation
    // example has something to be triggered by.
    member: {
      component: true,
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
    // The two components ./tools.ts writes and does not declare —
    // @yaks/kernel's `opened` and `archived` — declared here for the same
    // reason `member` is: a test needs the component, not the package.
    opened: {
      component: true,
      type: 'object',
      properties: {
        at: { type: 'string', format: 'date-time', stamped: true },
      },
    },
    archived: {
      component: true,
      type: 'object',
      properties: {
        at: { type: 'string', format: 'date-time', stamped: true },
      },
    },
    // The text of a tool's result, and which call it came from (@yaks/tools) —
    // declared here so a handler's prose result can be applied.
    content: {
      component: true,
      type: 'object',
      properties: { body: { type: 'string' } },
    },
    output: {
      component: true,
      type: 'object',
      properties: {
        source: { type: 'string', ref: 'entity', death: 'keep' },
      },
    },
    created: {
      component: true,
      type: 'object',
      properties: {
        at: { type: 'string', format: 'date-time', stamped: true },
      },
    },
    updated: {
      component: true,
      type: 'object',
      properties: {
        at: { type: 'string', format: 'date-time', stamped: true },
      },
    },
  },
}

/** The club's vocabulary: its own components, this package's, and the `doc` a
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

/** How the club is rigged for one test. */
export type Rig = {
  /** make every send fail with this reason, for the bounce */
  refuse?: string
  /** the domain whose addresses are the graph's own, for local delivery */
  local?: string
}

/** A club with a post room. */
export let clubhouse = ({ refuse, local }: Rig = {}): Club => {
  // The write function the sending effect records an outcome through: the
  // club's own graph, trusted, since `delivered` and `bounced` are
  // server-owned. `g` is built below, and this only ever runs post-commit.
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
        ...(local ? { local } : {}),
      }),
    ],
  })
  return { g, fx, post }
}
