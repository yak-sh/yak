// Shared test fixtures (not part of the published package — see deno.json): a
// book club that writes to its members.
//
// The club is a `space`, its people are `person` entities carrying an `email`,
// and its roster is a `member` row — the same three components @yaks/member
// ships, declared here so this package's tests need no dependency on it. The
// store is @yaks/ram: a Map holding the bundles, with the same apply() and the
// same queries as a database.

import {
  type Actor,
  type Bundle,
  detached,
  type Graph,
  graph,
  type Tx,
} from '@yaks/graph'
import { comps } from '@yaks/graph/bundle'
import { Refused } from '@yaks/graph/errors'
import { guard } from '@yaks/graph/guard'
import { ram } from '@yaks/ram'
import { type Effects, effects } from '@yaks/effects'
import { loadVocab, type Vocab, type VocabDoc } from '@yaks/vocab'
import { docDoc, docs } from '@yaks/doc'
import { kernelDoc } from '@yaks/kernel'
import { notifyDoc } from '@yaks/notify'
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
      properties: { name: { type: 'string' } },
    },
    person: {
      component: true,
      type: 'object',
      kind: true,
      properties: { name: { type: 'string' } },
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
        },
        role: { type: 'string', enum: ['owner', 'member'], default: 'member' },
      },
    },
    // Use the kernel's declared marks so this fixture fills server timestamps
    // with the same graph rules as every door.
    opened: kernelDoc.$defs!.opened,
    archived: kernelDoc.$defs!.archived,
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
        by: { type: 'string', ref: 'entity', death: 'keep', stamped: true },
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
export let club: Vocab = loadVocab([docDoc, mailDoc, notifyDoc, doc])

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
  /** whose graph it is: the writer of a batch that names none */
  owner?: Actor
}

/** A club with a post room. */
export let clubhouse = ({ refuse, owner }: Rig = {}): Club => {
  // The write function the sending effect records an outcome through: the
  // club's own graph, trusted, since `delivered` and `bounced` are
  // server-owned. `g` is built below, and this only ever runs post-commit.
  let fx = effects(club, { write: (b) => g.apply(b, { trusted: true }) })
  let post = stash(refuse ? { refuse } : {})
  let g = graph({
    storage: ram(club),
    vocab: club,
    ...(owner ? { actor: owner } : {}),
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

/** The sending handler's boundary without a graph: `rows` committed to a bare
 * store, what the handler reads them through, and its trusted write: refused
 * for a component or value the vocabulary cannot hold, and landing once each
 * `$was` it carries holds, as `apply()` checks them. Nothing is stamped, and
 * no effect hears of it. */
export let committed = (rows: Bundle[], vocab: Vocab = club): {
  tx: Tx
  write: (rows: Bundle[]) => Promise<Bundle[]>
} => {
  let tx = detached(ram(vocab))
  tx.patch(rows)
  return {
    tx,
    write: async (rows) => {
      let wrong = rows.flatMap((b) =>
        comps(b).flatMap(([name, c]) =>
          c ? vocab.check(name, c, { stamped: true }) : []
        )
      )
      if (wrong.length) throw new Refused(wrong.join('; '))
      await guard(rows, tx, vocab)
      return tx.get((await tx.patch(rows)).map((e) => e.eid))
    },
  }
}
