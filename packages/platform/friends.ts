// Friends on yaks.app (D-472): a friendship is two people who each confirm
// it. Each person's side is their own @yaks/persona relationship edge,
// `edge{from: them, to: the other}` + `relationship{role: "friend"}`, the
// shape the Task Graph gives people who know each other (T-2735), and their
// answer is the kernel's `decided{verdict}` mark on it. They are friends when
// both sides are approved. A suggestion is a side the platform put forward,
// marked `proposed{}`, which stands for nobody until its person answers it.
//
// Each person writes only their own side (`decide`), so nobody is friended
// without saying so, and turning someone down or unfriending them writes
// their own side declined, which the other person is never told.
import type { Bundle, Comp, Plugin, ReadTx, Tx } from '@yaks/graph'
import { hook } from '@yaks/graph/plugin'
import { Refused } from '@yaks/graph/errors'
import { edgeEid } from '@yaks/edge'
import { after, each } from '@yaks/fp'
import { line } from '@yaks/query'

/** The relationship role a friend's side carries. */
export let FRIEND = 'friend'

/** A person's answer about another: approved asks or accepts, declined
 * turns down or unfriends. */
export type Verdict = 'approved' | 'declined'

/** A person's answer about one other person, as the `$friend` request carries
 * it; trusted callers only, `person` being the one answering. */
export type Request = { person: string; other: string; verdict: Verdict }

/** Where another person stands with someone: friends, waiting on them to
 * answer the other's request (`asked`) or a suggestion (`suggested`), or
 * waiting on the other to answer theirs (`asking`). */
export type Standing = 'friend' | 'asked' | 'suggested' | 'asking'

/** Where another person stands, and since when: the newer of the two sides'
 * writes. */
export type Stand = { standing: Standing; at: string }

/** The eid of `from`'s side toward `to`: the relationship edge between them. */
export let side = (from: string, to: string): string =>
  edgeEid(from, 'relationship', to)

let part = (row: Bundle | undefined, name: string) =>
  row?.[name] as Comp | null | undefined

let id = (value: unknown) =>
  typeof value == 'string'
    ? value
    : String((value as { eid?: string })?.eid ?? '')

let verdictOf = (row: Bundle | undefined) =>
  part(row, 'decided')?.verdict as Verdict | undefined

let when = (row: Bundle | undefined) =>
  String(
    part(row, 'decided')?.at ?? part(row, 'updated')?.at ??
      part(row, 'created')?.at ?? '',
  )

/** One side of a friendship as a bundle, with whatever else it says. */
export let friendSide = (
  from: string,
  to: string,
  more: Record<string, Comp> = {},
): Bundle => ({
  entity: { eid: side(from, to) },
  edge: { from, to },
  relationship: { role: FRIEND },
  ...more,
})

/** A suggestion that two people be friends: a proposed side each way, for
 * each of them to answer. A side either already holds is left as it is. */
export let suggestion = (a: string, b: string): Bundle[] => [
  friendSide(a, b, { proposed: {} }),
  friendSide(b, a, { proposed: {} }),
]

/** The one read of every friend side a person is at either end of, with
 * each person at either end as a row of their own (their `doc{title}` and
 * `email{address}`), so the people it names come back with it. */
export let sidesOf = (person: string) =>
  line`.relationship.role=${FRIEND}&(.edge.from=${person}|.edge.to=${person})&.fields=edge,relationship,decided,proposed,created,updated,edge.from.doc.title,edge.from.email.address,edge.to.doc.title,edge.to.email.address`

/** Where each other person stands with `person`, by eid, from the friend
 * sides at either end of them. Whoever stands nowhere (turned down, never
 * answered, or never asked) is left out. */
export let standings = (
  person: string,
  sides: Bundle[],
): Map<string, Stand> => {
  let mine = new Map<string, Bundle>(), theirs = new Map<string, Bundle>()
  for (let row of sides) {
    let edge = part(row, 'edge')
    if (part(row, 'relationship')?.role != FRIEND || !edge) continue
    let from = id(edge.from), to = id(edge.to)
    if (from == person && to != person) mine.set(to, row)
    else if (to == person && from != person) theirs.set(from, row)
  }
  let out = new Map<string, Stand>()
  for (let other of new Set([...mine.keys(), ...theirs.keys()])) {
    let me = mine.get(other), them = theirs.get(other)
    let said = verdictOf(me), they = verdictOf(them)
    let standing: Standing | null = said == 'declined'
      ? null
      : said == 'approved'
      ? they == 'approved' ? 'friend' : 'asking'
      : they == 'approved'
      ? 'asked'
      : me?.proposed
      ? 'suggested'
      : null
    let at = [when(me), when(them)].sort().at(-1)!
    if (standing) out.set(other, { standing, at })
  }
  return out
}

/** The confirmed friends of people whose presence changed. */
export let confirmedFriends = (read: ReadTx['read'], people: string[]) =>
  after(
    read(
      line`.relationship.role=${FRIEND}&.decided.verdict=approved&(.edge.from=${people}|.edge.to=${people})&.fields=edge,relationship,decided`,
    ),
    (rows) =>
      new Set(people.flatMap((person) =>
        [...standings(person, rows)].flatMap(([other, stand]) =>
          stand.standing == 'friend' ? [other] : []
        )
      )),
  )

/** The side `person` writes for a `$friend` request: their own, toward a
 * person the directory holds who is not them. */
export let decide = (tx: Tx, { person, other, verdict }: Request) =>
  after(tx.get([other]), ([row]): Bundle[] => {
    if (
      !['approved', 'declined'].includes(verdict) ||
      !person || other == person || !row?.person || row.trashed
    ) {
      throw new Refused('Choose another yaks.app person to be friends with.')
    }
    return [friendSide(person, other, { decided: { verdict } })]
  })

/** The directory's `$friend` request: the platform's own, so a request no
 * trusted door made is refused. */
export let friendsPlugin = (): Plugin => ({
  name: 'yak/friends',
  requests: ['$friend'],
  authorize: hook(
    ['$friend'],
    (bundles, tx, _err, context) =>
      each(bundles, [] as Bundle[], (out, b) => {
        if (!b.$friend) return [...out, b]
        if (!context?.trusted) {
          throw new Refused('Use the friend tools or Updates.')
        }
        return after(
          decide(tx, b.$friend as Request),
          (rows) => [...out, ...rows],
        )
      }),
  ),
})
