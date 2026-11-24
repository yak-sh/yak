/**
 * The rows the signed-in person's own pages draw from (D-475 step 3): their
 * account, `account{name, email, hidden}`, and each confirmed friend,
 * `befriended{…}`, online first. The directory answers both as reads of the
 * person (graph.ts `/person/ws`), and the tab's page graph watches them through
 * its door (reach-door.ts), as it does the side's (./side-rows.ts).
 *
 * The person changes them through the page graph: an `account` row written
 * with a new name or `hidden` is that change, and a `friendMessage{to, words}`
 * or `friendAsk{email}` row is a message sent or a friend asked. The door does
 * each as the person (account-writes.ts) and answers what it made.
 *
 * @module
 */
import type { Bundle } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import type { VocabDoc } from '@yaks/vocab'

/** The person's account. */
export let ACCOUNT = '.account'

/** The person's confirmed friends, in the order their page lists them. */
export let FRIENDS = '.befriended'

/** How often where a friend is is read again while it is watched. */
export let SEEN_EVERY = 30_000

/** The person's account as their pages say it. */
export type Account = { name: string; email: string; hidden: boolean }

/** An app someone let the reader into, in the space it lives in. */
export type Shared = { eid: string; slug: string; title: string; space: string }

/** Where a friend is on yaks.app, as the reader may see it. */
export type Seen = {
  state: 'building' | 'online' | 'away'
  last?: string
  spaces: { slug: string; title: string }[]
  apps: { slug: string; title: string; space: string }[]
}

/** A confirmed friend as the Friends page lists them. */
export type Befriended = {
  person: string
  name: string
  seen?: Seen
  shared: Shared[]
}

let strings = { type: 'string' }
let named = {
  type: 'array',
  items: {
    type: 'object',
    properties: { slug: strings, title: strings, space: strings },
  },
}

export let accountWords: VocabDoc = {
  $defs: {
    account: {
      component: true,
      type: 'object',
      properties: {
        name: strings,
        email: strings,
        hidden: { type: 'boolean' },
      },
    },
    befriended: {
      component: true,
      type: 'object',
      properties: {
        person: strings,
        rank: { type: 'integer' },
        name: strings,
        seen: {
          type: 'object',
          properties: {
            state: strings,
            last: strings,
            spaces: named,
            apps: named,
          },
        },
        shared: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              eid: strings,
              slug: strings,
              title: strings,
              space: strings,
            },
          },
        },
      },
      required: ['person', 'rank', 'name', 'shared'],
    },
    friendMessage: {
      component: true,
      type: 'object',
      properties: { to: strings, words: strings },
      required: ['to', 'words'],
    },
    friendAsk: {
      component: true,
      type: 'object',
      properties: { email: strings },
      required: ['email'],
    },
  },
}

/** The eid of `person`'s account row. */
export let accountEid = (person: string): string =>
  derivedEid(`account|${person}`)

/** `person`'s account as a row. */
export let accountRow = (person: string, account: Account): Bundle => ({
  entity: { eid: accountEid(person) },
  account,
})

/** `person`'s friends as rows, `friends` in their page's order. */
export let friendRows = (person: string, friends: Befriended[]): Bundle[] =>
  friends.map((f, rank) => ({
    entity: { eid: derivedEid(`befriended|${person}|${f.person}`) },
    befriended: f.seen ? { ...f, rank } : { rank, ...without(f) },
  }))

let without = ({ seen: _, ...f }: Befriended) => f

/** The account `rows` hold, if any. */
export let accountOf = (rows: Bundle[]): Account | undefined =>
  rows.find((r) => r.account)?.account as Account | undefined

/** The friends `rows` hold, in their page's order. */
export let friendsOf = (rows: Bundle[]): Befriended[] =>
  rows.flatMap((r) =>
    r.befriended ? [r.befriended as Befriended & { rank: number }] : []
  )
    .sort((a, b) => a.rank - b.rank)
    .map(({ rank: _, ...f }) => f)

/** Whether the directory answers `line` as a read of the person. */
export let accountLine = (line: string): boolean =>
  line == ACCOUNT || line == FRIENDS
