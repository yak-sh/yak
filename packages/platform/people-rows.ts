/**
 * What a space's People page (./people-view.ts) is drawn from, as the tab's
 * page graph holds it (D-475 step 5), and what it writes there:
 *
 * - `holder{space, place, held, on, person, name, email, role, sent, rank}`:
 *   one place somebody holds or is offered in the space or one of its apps
 *   (a seat, a grant, an invitation not yet accepted), with what to call
 *   them, in the page's order. `place` is the row holding it.
 * - `admitted{space, operator, slug, title, role}`: the Operator of another
 *   space let in to work here, and what it may do.
 * - `invitable{person, name, rank}`: each of the person's confirmed friends,
 *   whom an invitation may name by picking them, by name.
 *
 * The directory answers each as a read of the person, the first two only for
 * a space they own (yaks.app's side.ts `personRows`): who is in a space, and
 * whom the owner invited, is the owner's alone. The page also draws from the
 * side's rows (./side-rows.ts): the space's apps, and the spaces whose
 * Operators may be let in.
 *
 * The owner changes them through the page graph, each row an act the door
 * does as them with the tool their assistant calls (yaks.app's
 * people-writes.ts), answered with what it came to in `said`:
 * `memberAdd{space, friend, email, app, role, note}` invites someone,
 * `memberRemove{space, email, app}` takes them off or withdraws an
 * invitation, `inviteAgain{space, invite}` sends its letter again, and
 * `operatorAdmit{space, operator, role}` and `operatorOut{space, operator}`
 * let another space's Operator in and take it back out.
 *
 * @module
 */
import type { Bundle } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import type { VocabDoc } from '@yaks/vocab'
import peopleJson from './vocab/people.vocab.json' with { type: 'json' }

/** What one may do in a space or an app. */
export type Role = 'owner' | 'editor' | 'viewer'

/** One person holding or offered a place in a space or one of its apps:
 * a seat in the space, a grant on an app, or an invitation to either, and
 * for an invitation when its latest letter went. */
export type Holder = {
  place: string
  held: 'seat' | 'grant' | 'invite'
  on: string
  person: string
  name: string
  email: string | null
  role: Role
  sent: string | null
}

/** A confirmed friend an invitation may name. */
export type Invitable = { person: string; name: string }

/** Another space's Operator let in to work here. */
export type Admitted = {
  operator: string
  slug: string
  title: string
  role: Role
}

let HOLDERS = '.holder.space='
let ADMITTED = '.admitted.space='

/** The line of who holds or is offered a place in the space `eid`. */
export let holders = (eid: string): string => HOLDERS + eid

/** The line of the other spaces' Operators let into the space `eid`. */
export let admitted = (eid: string): string => ADMITTED + eid

/** The space a {@link holders} line asks about, or undefined. */
export let holdersSpace = (line: string): string | undefined =>
  line.startsWith(HOLDERS) ? line.slice(HOLDERS.length) : undefined

/** The space an {@link admitted} line asks about, or undefined. */
export let admittedSpace = (line: string): string | undefined =>
  line.startsWith(ADMITTED) ? line.slice(ADMITTED.length) : undefined

/** The person's confirmed friends, whom an invitation may name. */
export let INVITABLE = '.invitable'

/** Whether the directory answers `line` as a read of the person. */
export let peopleLine = (line: string): boolean =>
  line == INVITABLE || holdersSpace(line) != undefined ||
  admittedSpace(line) != undefined

export let peopleWords: VocabDoc = peopleJson as VocabDoc

/** The acts the People page writes. */
export let PEOPLE_ACTS = [
  'memberAdd',
  'memberRemove',
  'inviteAgain',
  'operatorAdmit',
  'operatorOut',
] as const

/** One of {@link PEOPLE_ACTS}. */
export type PeopleAct = typeof PEOPLE_ACTS[number]

/** Whether `bundles` are the People page's acts. */
export let peopleWrites = (bundles: Bundle[]): boolean =>
  bundles.length > 0 &&
  bundles.every((b) => PEOPLE_ACTS.some((a) => a in b))

/** Who holds or is offered a place in the space `space`, as `person`'s rows,
 * `all` in the page's order. */
export let holderRows = (
  person: string,
  space: string,
  all: Holder[],
): Bundle[] =>
  all.map((h, rank) => ({
    entity: { eid: derivedEid(`holder|${person}|${h.place}`) },
    holder: { space, ...h, rank },
  }))

/** The other spaces' Operators let into the space `space`, as `person`'s
 * rows. */
export let admittedRows = (
  person: string,
  space: string,
  all: Admitted[],
): Bundle[] =>
  all.map((a) => ({
    entity: { eid: derivedEid(`admitted|${person}|${space}|${a.operator}`) },
    admitted: { space, ...a },
  }))

/** `person`'s confirmed friends as rows, `all` by name. */
export let invitableRows = (person: string, all: Invitable[]): Bundle[] =>
  all.map((f, rank) => ({
    entity: { eid: derivedEid(`invitable|${person}|${f.person}`) },
    invitable: { ...f, rank },
  }))

/** The friends `rows` hold, by name. */
export let invitableOf = (rows: Bundle[]): Invitable[] =>
  rows.flatMap((r) =>
    r.invitable ? [r.invitable as Invitable & { rank: number }] : []
  )
    .sort((a, b) => a.rank - b.rank)
    .map(({ person, name }) => ({ person, name }))

/** The holders `rows` hold, in the page's order. */
export let holdersOf = (rows: Bundle[]): Holder[] =>
  rows.flatMap((r) =>
    r.holder ? [r.holder as Holder & { space: string; rank: number }] : []
  )
    .sort((a, b) => a.rank - b.rank)
    .map(({ space: _, rank: __, ...h }) => h)

/** The Operators `rows` hold, by name. */
export let admittedOf = (rows: Bundle[]): Admitted[] =>
  rows.flatMap((r) =>
    r.admitted ? [r.admitted as Admitted & { space: string }] : []
  )
    .map(({ space: _, ...a }) => a)
    .sort((a, b) => (a.title || a.slug).localeCompare(b.title || b.slug))
