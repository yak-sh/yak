/**
 * The rows a space's Updates page draws its cards from (D-475 step 4): each
 * of the person's Updates in the space from its Operator,
 * `updateCard{space, rank, update}`, which the space's Operator store answers
 * as a live read of the person (operator-api.ts), and what the directory
 * holds for them there, `updateOffer{…}` the same (an app or domain offered,
 * a friend request, a friend's message), which the directory answers
 * (side.ts). The tab's page graph watches both through its door
 * (reach-door.ts), so a card shows as it is written and changes as it is
 * answered. The page lists them together, what needs the person first, then
 * the newest.
 *
 * A row's eid is derived from the person and the update, so two people's
 * rows never meet and an update keeps its row as it changes.
 *
 * @module
 */
import type { Bundle } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import type { VocabDoc } from '@yaks/vocab'
import type { Choice } from '@yaks/task'

/** Where an update came from: its conversation, opened in the chat at the
 * entry it was written from. */
export type Place = { chat: string; entry?: string; seq?: number }

/** An entity a choice shows, with the components it is drawn by: an image
 * or file kept in the space (`artifact`), prose (`doc`), or neither, an app,
 * whose draft is drawn. */
export type Shown = {
  choice: string
  eid: string
  artifact?: { address: string; media_type: string }
  doc?: { title?: string; body?: string }
}

/** One item of a person's Updates, as their page draws it. */
export type Update = {
  eid: string
  /** It asks them something (Needs you). */
  needs: boolean
  at: string
  unread: boolean
  /** Its words: what happened, or the question. */
  words: string
  /** A notice's line naming the app and what happened. */
  subject?: string
  /** What it tells of: an app, the space, or a task of the Operator's. */
  about?: string
  /** Where it came from: its conversation, opened in the chat at the entry
   * it was written from. */
  from?: Place
  /** They dismissed it, and nothing has happened on it since. */
  dismissed: boolean
  transfer?: { editor: boolean; kind?: 'domain' }
  /** A friend request or suggestion from this person (friends.ts). */
  friend?: { person: string; suggested: boolean }
  /** A message from a friend, answered by a reply to them (friends.ts). */
  message?: { friend: string; name: string; invite?: string }
  choices?: Choice[]
  recommended?: string
  /** What its choices show, in the order they show it. */
  shown?: Shown[]
}

/** Where an update's card is on its page, for a link to it. */
export let updateAnchor = (eid: string): string => `u-${eid}`

let CARDS = '.updateCard.space='
let OFFERS = '.updateOffer.space='

/** The person's Updates from the Operator of the space `eid`. */
export let updateCards = (eid: string): string => CARDS + eid

/** What the directory holds for the person in the space `eid`. */
export let updateOffers = (eid: string): string => OFFERS + eid

/** The space an `updateCards` line asks about, or undefined for another
 * line. */
export let cardsSpace = (line: string): string | undefined =>
  line.startsWith(CARDS) ? line.slice(CARDS.length) : undefined

/** The space an `updateOffers` line asks about, or undefined for another
 * line. */
export let offersSpace = (line: string): string | undefined =>
  line.startsWith(OFFERS) ? line.slice(OFFERS.length) : undefined

let held = {
  component: true,
  type: 'object',
  properties: {
    space: { type: 'string' },
    rank: { type: 'integer' },
    update: { type: 'object' },
  },
  required: ['space', 'rank', 'update'],
}

export let updateWords: VocabDoc = {
  $defs: { updateCard: held, updateOffer: held },
}

type Held = { space: string; rank: number; update: Update }
type From = 'updateCard' | 'updateOffer'

let rowsOf =
  (from: From) =>
  (person: string, space: string, updates: Update[]): Bundle[] =>
    updates.map((update, rank) => ({
      entity: { eid: derivedEid(`${from}|${person}|${update.eid}`) },
      [from]: { space, rank, update },
    }))

/** `person`'s Updates from the Operator of the space `space`, as rows in the
 * order it lists them. */
export let updateRows: (
  person: string,
  space: string,
  updates: Update[],
) => Bundle[] = rowsOf('updateCard')

/** What the directory holds for `person` in the space `space`, as rows. */
export let offerRows: (
  person: string,
  space: string,
  updates: Update[],
) => Bundle[] = rowsOf('updateOffer')

/** The Updates in the space `space` that `rows` hold, both kinds, in their
 * page's order: what needs the person first, then the newest. */
export let updatesIn = (rows: Bundle[], space: string): Update[] =>
  rows.flatMap((r) =>
    (['updateCard', 'updateOffer'] as From[]).flatMap((from) => {
      let held = r[from] as Held | undefined
      return held?.space == space ? [held] : []
    })
  ).sort((a, b) => newsOrder(a.update, b.update) || a.rank - b.rank)
    .map((h) => h.update)

/** The order a page lists Updates in: what needs the person first, then the
 * newest. */
export let newsOrder = (
  a: Pick<Update, 'needs' | 'at'>,
  b: Pick<Update, 'needs' | 'at'>,
): number => +b.needs - +a.needs || b.at.localeCompare(a.at)
