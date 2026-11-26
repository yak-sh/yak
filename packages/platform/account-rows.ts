/**
 * The rows the signed-in person's own pages draw from (D-475 step 3): their
 * account, `account{name, email, hidden}`, each browser signed in as them,
 * `signedIn{agent, place, at}`, each confirmed friend, `befriended{…}`,
 * online first, each app of someone else's they may open, `sharedApp{rank,
 * eid, slug, title, space}`, and their invite to yaks.app, `invitePage{said,
 * text, mail, address, joined, built}`, and each chat platform whose bot
 * yaks.app keeps, with the accounts they linked there, `chatLink{rank,
 * platform, integration, accounts}`, and each message between them and a
 * confirmed friend, `friendMessage{from, to, words, at, read, operator}`, the
 * newest {@link HELD_MESSAGES}. The directory answers each as a read
 * of the person (graph.ts `/person/ws`), and the tab's page graph watches them through
 * its door (reach-door.ts), as it does the side's (./side-rows.ts).
 *
 * The person changes them through the page graph: an `account` row written
 * with a new name, `hidden` or `first` (the slug of a space they own, which
 * `/manage` opens) is that change; a `signOut{session}` row signs out one
 * browser, or with `session: 'all'` every one; a `friendMessage{to, words}`
 * row is a message sent, its eid the message's own, so the row it shows as
 * at once is the one the directory answers; the same row written `read` is
 * the message read; and a `friendAsk{email}` row is a friend asked. The door
 * does each as the person (account-writes.ts) and answers what it made.
 *
 * @module
 */
import type { Bundle } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import type { Activity } from '@yaks/notify/whereabouts'
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

/** The chat platforms the person links their own account on. */
export let CHAT_LINKS = '.chatLink'

/** The person's messages with their confirmed friends, newest first. */
export let FRIEND_MESSAGES = '.friendMessage'

/** How many of the newest messages with friends a tab holds. */
export let HELD_MESSAGES = 200

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
 * link a friend opens on the web, the links that open the words as a text
 * (where there is a number to text) and as a letter to `address`, and how
 * many people signed up through it and how many of them built an app. */
export type Invitation = {
  said: string
  link: string
  text: string | null
  mail: string
  address: string
  joined: number
  built: number
}

/** A chat platform the person links their own account on: the integration
 * that links one, and the names of the accounts they linked. */
export type ChatLink = {
  platform: string
  integration: string
  accounts: string[]
}

/** Where a friend is on yaks.app, as the reader may see it. */
export type Seen = {
  state: 'building' | 'online' | 'away'
  activity?: Activity
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

/** One message between the person and a friend: who it is from and to,
 * its words, when it was sent, whether its reader read it, and whether the
 * sender's Operator wrote it for them. */
export type FriendMessage = {
  from: string
  to: string
  words: string
  at: string
  read: boolean
  operator: boolean
  invite?: string
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
            activity: { type: 'string', enum: ['active', 'away', 'offline'] },
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
        link: strings,
        text: { type: ['string', 'null'] },
        mail: strings,
        address: strings,
        joined: { type: 'integer' },
        built: { type: 'integer' },
      },
      required: [
        'said',
        'link',
        'text',
        'mail',
        'address',
        'joined',
        'built',
      ],
    },
    chatLink: {
      component: true,
      type: 'object',
      properties: {
        rank: { type: 'integer' },
        platform: strings,
        integration: strings,
        accounts: { type: 'array', items: strings },
      },
      required: ['rank', 'platform', 'integration', 'accounts'],
    },
    friendMessage: {
      component: true,
      type: 'object',
      properties: {
        from: strings,
        to: strings,
        words: strings,
        at: strings,
        read: { type: 'boolean' },
        operator: { type: 'boolean' },
        invite: strings,
      },
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

/** Messages with friends as rows, each under its own eid. */
export let messageRows = (
  messages: (FriendMessage & { eid: string })[],
): Bundle[] =>
  messages.map(({ eid, ...m }) => ({ entity: { eid }, friendMessage: m }))

/** The messages `rows` hold, oldest first, each with its eid. */
export let messagesOf = (
  rows: Bundle[],
): (FriendMessage & { eid: string })[] =>
  rows.flatMap((r) =>
    r.friendMessage
      ? [{ eid: r.entity.eid, ...r.friendMessage as FriendMessage }]
      : []
  ).sort((a, b) => a.at.localeCompare(b.at) || a.eid.localeCompare(b.eid))

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

/** The chat platforms `person` links their own account on as rows, `links`
 * in their page's order. */
export let chatLinkRows = (person: string, links: ChatLink[]): Bundle[] =>
  links.map((l, rank) => ({
    entity: { eid: derivedEid(`chatLink|${person}|${l.integration}`) },
    chatLink: { rank, ...l },
  }))

/** The chat platforms `rows` hold, in their page's order. */
export let chatLinksOf = (rows: Bundle[]): ChatLink[] =>
  rows.flatMap((r) =>
    r.chatLink ? [r.chatLink as ChatLink & { rank: number }] : []
  )
    .sort((a, b) => a.rank - b.rank)
    .map(({ rank: _, ...l }) => l)

/** Whether the directory answers `line` as a read of the person. */
export let accountLine = (line: string): boolean =>
  line == ACCOUNT || line == FRIENDS || line == SIGNED_IN ||
  line == SHARED_APPS || line == INVITE_PAGE || line == CHAT_LINKS ||
  line == FRIEND_MESSAGES
