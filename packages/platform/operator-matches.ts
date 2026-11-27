/**
 * What a space's Matches page (./operator-matches-view.ts) is drawn from, as
 * the tab's page graph holds it (D-475 step 4), and what it writes there.
 *
 * - `matchesPage{space, round, …}`: the rounds a member may pick in, with
 *   round empty (`rounds`), or one round as they tap through it (its pair to
 *   pick in next, how many are left, where each side stands). The rounds and
 *   every pick are @yaks/trial's, in the space's Operator store, which
 *   answers `matchesPage(space, round)` live as a read of the person
 *   (yaks.app's operator-api.ts), so a pick made in the chat or another tab
 *   shows at once.
 * - `pickMatch{space, round, pair, chose, why}`: a pick in one of a round's
 *   pairs, `first`, `second` or `neither`. The page graph's door takes it to
 *   that store as the person and answers it with the round as it then
 *   stands.
 *
 * @module
 */
import type { Bundle } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import { line } from '@yaks/query/core'
import type { VocabDoc } from '@yaks/vocab'
import operatorMatchesJson from './vocab/operator-matches.vocab.json' with {
  type: 'json',
}

/** A round a member may pick in, with how many of its pairs are left for
 * them, of how many. */
export type Round = { round: string; title: string; left: number; of: number }

/** One side as the page draws it: what the round shows of it (an attempt's
 * parts, an image, a document), or only its eid, a draft of one of the
 * space's apps. */
export type Tapped = Bundle

/** A round as a person taps through it: the pair to pick in next, numbered
 * as `trial_pairs` numbers it, how many pairs are left worth picking in and
 * how many they picked in, and where each side stands so far, with what was
 * measured of it. */
export type Tapping = {
  round: string
  title: string
  parts: string[]
  card?: {
    n: number
    question?: string
    first: Tapped & { label: string }
    second: Tapped & { label: string }
  }
  left: number
  picked: number
  places: { eid: string; label: string; shown: Tapped; measured: string }[]
}

/** What the page shows: the rounds to pick in, or one round. */
export type Matches = { rounds: Round[] } | Tapping

/** A pick: the round, its pair, the side chosen, and why where said. */
export type Pick = {
  space: string
  round: string
  pair: number
  chose: string
  why?: string
}

let PAGE = '.matchesPage.space='

/** The line of the Matches page in the space `space`: its rounds, or with
 * `round` that round. */
export let matchesPage = (space: string, round = ''): string =>
  line`.matchesPage.space=${space}&.matchesPage.round=${round}`

/** The space and round a `matchesPage` line names, or undefined for another
 * line. */
export let matchesAsked = (
  text: string,
): { space: string; round: string } | undefined => {
  if (!text.startsWith(PAGE)) return undefined
  let m =
    /^\.matchesPage\.space=("(?:[^"\\]|\\.)*"|[^&]*)&\.matchesPage\.round=("(?:[^"\\]|\\.)*"|.*)$/
      .exec(text)
  if (!m) return undefined
  let bare = (v: string) =>
    v.startsWith('"') ? v.slice(1, -1).replace(/\\(.)/g, '$1') : v
  let asked = { space: bare(m[1]), round: bare(m[2]) }
  return matchesPage(asked.space, asked.round) == text ? asked : undefined
}

export let matchesWords: VocabDoc = operatorMatchesJson as VocabDoc

/** The Matches page of `space` as `round` asks it (empty for its rounds),
 * as a row. */
export let matchesRow = (
  space: string,
  round: string,
  read: Matches,
): Bundle => ({
  entity: { eid: derivedEid(`matchesPage|${space}|${round}`) },
  matchesPage: { ...read, space, round },
})

/** What the page is drawn from, if `rows` hold it. */
export let matchesOf = (rows: Bundle[]): Matches | undefined => {
  let row = rows.find((r) => r.matchesPage)?.matchesPage as
    | (Matches & { space: string })
    | undefined
  if (!row) return undefined
  let { space: _, ...read } = row
  if ('rounds' in read) return { rounds: read.rounds }
  return read as Tapping
}

/** The pick `bundles` write, when they are one, else undefined. */
export let pickOf = (bundles: Bundle[]): Pick | undefined => {
  let [b, ...rest] = bundles
  let pick = b?.pickMatch as Pick | undefined
  if (rest.length || !pick?.space || !pick.round) return undefined
  return pick
}
