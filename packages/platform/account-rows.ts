/**
 * The rows the signed-in person's own pages draw from (D-475 step 3): their
 * account, `account{name, email, hidden}`, each browser signed in as them,
 * `signedIn{agent, place, at}`, each confirmed friend, `befriended{…}`,
 * online first, each app of someone else's they may open, `sharedApp{rank,
 * eid, slug, title, space}`, and their invite to yaks.app, `invitePage{said,
 * text, mail, address, joined, built}`. The directory answers each as a read
 * of the person (graph.ts `/person/ws`), and the tab's page graph watches them through
 * its door (reach-door.ts), as it does the side's (./side-rows.ts).
 *
 * The person changes them through the page graph: an `account` row written
 * with a new name, `hidden` or `first` (the slug of a space they own, which
 * `/manage` opens) is that change; a `signOut{session}` row signs out one
 * browser, or with `session: 'all'` every one; and a `friendMessage{to,
 * words}` or `friendAsk{email}` row is a message sent or a friend asked. The door does
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

/** The browsers signed in as the person. */
export let SIGNED_IN = '.signedIn'

/** The apps of other people's spaces the person may open. */
export let SHARED_APPS = '.sharedApp'

/** The person's own invite to yaks.app. */
export let INVITE_PAGE = '.invitePage'

/** How often where a friend is is read again while it is watched. */
export let SEEN_EVERY = 30_000

/** The person's account as their pages say it. */
export type Account = { name: string; email: string; hidden: boolean }

/** What `account` takes beside the account itself: the space `/manage`
 * opens first. */
export type AccountWrite = Partial<Account> & { first?: string }

/** A browser signed in as the person: its user-agent, where its network
 * placed it and when it signed in, where each is known. */
export type SignedIn = { agent: string; place?: string; at?: string }

/** An app someone let the reader into, in the space it lives in. */
export type Shared = { eid: string; slug: string; title: string; space: string }

/** What a person's invite page draws: the words carrying their code, the
 * links that open them as a text (where there is a number to text) and as a
 * letter to `address`, and how many people signed up through it and how many
 * of them built an app. */
export type Invitation = {
  said: string
  text: string | null
  mail: string
  address: string
  joined: number
  built: number
}

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
        first: strings,
      },
    },
    signedIn: {
      component: true,
      type: 'object',
      properties: { agent: strings, place: strings, at: strings },
      required: ['agent'],
    },
    signOut: {
      component: true,
      type: 'object',
      properties: { session: strings },
      required: ['session'],
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
    sharedApp: {
      component: true,
      type: 'object',
      properties: {
        rank: { type: 'integer' },
        eid: strings,
        slug: strings,
        title: strings,
        space: strings,
      },
      required: ['rank', 'eid', 'slug', 'title', 'space'],
    },
    invitePage: {
      component: true,
      type: 'object',
      properties: {
        said: strings,
        text: { type: ['string', 'null'] },
        mail: strings,
        address: strings,
        joined: { type: 'integer' },
        built: { type: 'integer' },
      },
      required: ['said', 'text', 'mail', 'address', 'joined', 'built'],
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

/** The browsers `sessions` as rows, each the session's own eid. */
export let signedInRows = (
  sessions: (SignedIn & { eid: string })[],
): Bundle[] =>
  sessions.map(({ eid, agent, place, at }) => ({
    entity: { eid },
    signedIn: { agent, ...place ? { place } : {}, ...at ? { at } : {} },
  }))

/** The browsers `rows` hold, each with its session's eid. */
export let signedInOf = (rows: Bundle[]): (SignedIn & { eid: string })[] =>
  rows.flatMap((r) =>
    r.signedIn ? [{ eid: r.entity.eid, ...r.signedIn as SignedIn }] : []
  )

/** The friends `rows` hold, in their page's order. */
export let friendsOf = (rows: Bundle[]): Befriended[] =>
  rows.flatMap((r) =>
    r.befriended ? [r.befriended as Befriended & { rank: number }] : []
  )
    .sort((a, b) => a.rank - b.rank)
    .map(({ rank: _, ...f }) => f)

/** The apps `shared` with `person` as rows, in their page's order. */
export let sharedRows = (person: string, shared: Shared[]): Bundle[] =>
  shared.map((a, rank) => ({
    entity: { eid: derivedEid(`sharedApp|${person}|${a.eid}`) },
    sharedApp: { rank, ...a },
  }))

/** The apps `rows` hold, in their page's order. */
export let sharedOf = (rows: Bundle[]): Shared[] =>
  rows.flatMap((r) =>
    r.sharedApp ? [r.sharedApp as Shared & { rank: number }] : []
  )
    .sort((a, b) => a.rank - b.rank)
    .map(({ rank: _, ...a }) => a)

/** `person`'s invite as a row. */
export let inviteRow = (person: string, invite: Invitation): Bundle => ({
  entity: { eid: derivedEid(`invitePage|${person}`) },
  invitePage: invite,
})

/** The invite `rows` hold, if any. */
export let inviteOf = (rows: Bundle[]): Invitation | undefined =>
  rows.find((r) => r.invitePage)?.invitePage as Invitation | undefined

/** Whether the directory answers `line` as a read of the person. */
export let accountLine = (line: string): boolean =>
  line == ACCOUNT || line == FRIENDS || line == SIGNED_IN ||
  line == SHARED_APPS || line == INVITE_PAGE
