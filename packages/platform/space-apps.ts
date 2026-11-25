/**
 * What a space's Apps page (./space-apps-view.ts) is drawn from, as the tab's
 * page graph holds it (D-475 step 5):
 *
 * - `spaceApp{space, app, slug, title, …, made, deployed}`: each app the page
 *   lists, with when it was made and last deployed and who did each, which
 *   the directory answers as a read of the person (yaks.app's side.ts), live,
 *   so an app made, renamed, deployed or trashed elsewhere shows at once.
 * - `appBroken{space, app, errors}`: what is broken in each app, read from
 *   the space's tracker with what its Operator made of each break. No store
 *   holds it, so the page graph's door reads it as the page asks.
 *
 * Whether an agent is connected is the person's agents' row (./agents.ts).
 *
 * A row's eid is derived from the person and the app it shows, so two
 * people's rows never meet.
 *
 * @module
 */
import type { Bundle } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import type { VocabDoc } from '@yaks/vocab'
import type { Stamp, Writers } from './app-tile.ts'
import type { MarkedApp } from './routes.ts'

/** What the space's Operator made of a break: its answer, or why it could
 * not finish; neither while it works. */
export type Fixing = { answer?: string; failed?: string }

/** A break as its owner's dashboard shows it: what it said and where, in the
 * words its line says to their assistant, how often, when it last did, and
 * the Operator request its first occurrence started. */
export type Plain = {
  said: string
  where: string
  times: number
  at: string
  fix: string
  operator?: Fixing
}

/** When something was written, by whom, and what they are called. */
export type Named = Stamp & { name?: string }

/** An app as the Apps page lists it. */
export type Listed = MarkedApp & {
  home?: boolean
  access?: string | null
  /** how it stands with the gallery, said to its owner */
  gallery?: string
  made?: Named | null
  deployed?: Named | null
}

/** An app and its open breaks, newest first. */
export type Broken = Listed & { errors?: Plain[] }

let APPS = '.spaceApp.space='
let BROKEN = '.appBroken.space='

/** The apps the Apps page of the space `eid` lists. */
export let spaceApps = (eid: string): string => APPS + eid

/** The space a `spaceApps` line asks about, or undefined for another line. */
export let listedSpace = (line: string): string | undefined =>
  line.startsWith(APPS) ? line.slice(APPS.length) : undefined

/** What is broken in each app of the space `eid`. */
export let brokenApps = (eid: string): string => BROKEN + eid

/** The space a `brokenApps` line asks about, or undefined for another line. */
export let brokenSpace = (line: string): string | undefined =>
  line.startsWith(BROKEN) ? line.slice(BROKEN.length) : undefined

let strings = { type: 'string' }
let stamp = {
  type: ['object', 'null'],
  properties: { at: strings, by: { type: ['string', 'null'] }, name: strings },
}

export let spaceAppsWords: VocabDoc = {
  $defs: {
    spaceApp: {
      component: true,
      type: 'object',
      properties: {
        space: strings,
        app: strings,
        slug: strings,
        title: strings,
        source: { type: ['string', 'null'] },
        generatedIcon: strings,
        home: { type: 'boolean' },
        access: { type: ['string', 'null'] },
        gallery: strings,
        made: stamp,
        deployed: stamp,
      },
      required: ['space', 'app', 'slug', 'title'],
    },
    appBroken: {
      component: true,
      type: 'object',
      properties: {
        space: strings,
        app: strings,
        errors: { type: 'array', items: { type: 'object' } },
      },
      required: ['space', 'app', 'errors'],
    },
  },
}

// A property the row has no word on is left out, as the graph keeps it.
let drop = <T extends Record<string, unknown>>(o: T): T =>
  Object.fromEntries(
    Object.entries(o).filter(([, v]) => v !== undefined),
  ) as T

/** The apps of the space `space` the page lists, as `person`'s rows. */
export let listedRows = (
  person: string,
  space: string,
  apps: Listed[],
): Bundle[] =>
  apps.map(({ eid, ...a }) => ({
    entity: { eid: derivedEid(`space-app|${person}|${eid}`) },
    spaceApp: drop({ space, app: eid, ...a }),
  }))

/** What is broken in the apps of the space `space`, as `person`'s rows: one
 * an app with any open break. */
export let brokenRows = (
  person: string,
  space: string,
  broken: ReadonlyMap<string, Plain[]>,
): Bundle[] =>
  [...broken].filter(([, errors]) => errors.length).map(([app, errors]) => ({
    entity: { eid: derivedEid(`app-broken|${person}|${app}`) },
    appBroken: { space, app, errors },
  }))

/** The apps of `space` that `rows` hold, each with its open breaks from
 * `broken`. */
export let listedOf = (
  rows: Bundle[],
  space: string,
  broken: Bundle[] = [],
): Broken[] => {
  let errors = new Map(
    broken.flatMap((r) => {
      let b = r.appBroken as
        | { space: string; app: string; errors: Plain[] }
        | undefined
      return b?.space == space ? [[b.app, b.errors] as const] : []
    }),
  )
  return rows.flatMap((r) => {
    let a = r.spaceApp as
      | (Omit<Listed, 'eid'> & { space: string; app: string })
      | undefined
    if (a?.space != space) return []
    let { space: _, app, ...rest } = a
    return [drop({ eid: app, ...rest, errors: errors.get(app) })]
  })
}

/** What each writer the apps' stamps name is called. */
export let writersOf = (apps: Listed[]): Writers =>
  new Map(
    apps.flatMap((a) =>
      [a.made, a.deployed].flatMap((s) =>
        s?.by && s.name ? [[s.by, s.name] as const] : []
      )
    ),
  )
