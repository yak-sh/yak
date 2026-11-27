/**
 * The rows yaks.app's sidebar draws from (D-475 step 2): each space the
 * signed-in person may work in, as its selector offers it, and the apps of
 * one space they may open. The directory answers both as reads of the
 * person (graph.ts `/person/ws`), and a tab's page graph watches them through
 * its door (reach-door.ts), so the sidebar redraws as a space or an app is
 * made, renamed, shared or taken away (./side-browser.ts).
 *
 * A row's eid is derived from the person and what it shows, so a renamed space
 * or app is the same row with new words, and two people's rows never meet.
 *
 * @module
 */
import type { Bundle } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import type { VocabDoc } from '@yaks/vocab'
import type { MarkedApp } from './routes.ts'
import sideJson from './vocab/side.vocab.json' with { type: 'json' }

/** A space the side's selector offers: whether it is the person's to own,
 * whether it is the one they open first (`member.own`), and of one they are
 * only a member of, its owner's name. */
export type Picked = {
  slug: string
  title: string
  owner: boolean
  own: boolean
  whose?: string
  /** What its Operator is called. */
  operator?: string
  /** Where its logo is drawn from (./routes.ts `logoPath`), where it has one. */
  logo?: string
}

/** The person's spaces, in the order the selector lists them. */
export let SIDE_SPACES = '.sideSpace'

let APPS = '.sideApp.space='

/** The apps of the space `eid` the person may open, in the side's order. */
export let sideApps = (eid: string): string => APPS + eid

/** The space a `sideApps` line asks about, or undefined for another line. */
export let appsSpace = (line: string): string | undefined =>
  line.startsWith(APPS) ? line.slice(APPS.length) : undefined

/** Whether the directory answers `line` as a read of the person. */
export let sideLine = (line: string): boolean =>
  line == SIDE_SPACES || !!appsSpace(line)

export let sideWords: VocabDoc = sideJson as VocabDoc

/** The person's spaces as rows, `spaces` in the selector's order, each with
 * the eid of the space it is. */
export let spaceRows = (
  person: string,
  spaces: (Picked & { eid: string })[],
): Bundle[] =>
  spaces.map(({ eid, ...s }, rank) => ({
    entity: { eid: derivedEid(`side-space|${person}|${eid}`) },
    sideSpace: drop({ space: eid, rank, ...s }),
  }))

/** The apps of the space `space` the person may open, as rows, in order. */
export let appRows = (
  person: string,
  space: string,
  apps: MarkedApp[],
): Bundle[] =>
  apps.map(({ eid, slug, title, source, generatedIcon }, rank) => ({
    entity: { eid: derivedEid(`side-app|${person}|${eid}`) },
    sideApp: drop({
      space,
      rank,
      app: eid,
      slug,
      title,
      source,
      generatedIcon,
    }),
  }))

// A property the row has no word on is left out, as the graph keeps it.
let drop = <T extends Record<string, unknown>>(o: T): T =>
  Object.fromEntries(
    Object.entries(o).filter(([, v]) => v !== undefined),
  ) as T

let ranked = <T extends { rank: number }>(rows: Bundle[], comp: string) =>
  rows.flatMap((r) => r[comp] ? [r[comp] as T] : [])
    .sort((a, b) => a.rank - b.rank)

/** The spaces `rows` hold, in the selector's order, each with its eid. */
export let pickedOf = (rows: Bundle[]): (Picked & { eid: string })[] =>
  ranked<Picked & { space: string; rank: number }>(rows, 'sideSpace')
    .map(({ space, rank: _r, ...s }) => ({ eid: space, ...s }))

/** The apps of `space` that `rows` hold, in the side's order. */
export let appsOf = (rows: Bundle[], space: string): MarkedApp[] =>
  ranked<MarkedApp & { space: string; rank: number; app: string }>(
    rows,
    'sideApp',
  ).filter((a) => a.space == space)
    .map(({ app, slug, title, source, generatedIcon }) =>
      drop({ eid: app, slug, title, source, generatedIcon })
    )
