/**
 * What the app open beside the chat (./app-canvas-view.ts) is drawn from, as
 * the tab's page graph holds it (D-475 step 5):
 *
 * - the app's `sideApp` row (./side-rows.ts), which the side already watches:
 *   its name, its icon, and whether it is live, so the app's head and its
 *   live preview draw at once;
 * - `appMaking{app, made, pages, steps, draft, edited}`: what it is made of,
 *   read from its draft as it stands, its workflow, and its draft's preview
 *   link and when that draft was last written.
 *   No store holds this: yaks.app's page graph door answers the line
 *   `appMaking(app)` by reading it, and reads it again as the app's draft,
 *   its row or its workflow moves;
 * - `appDrafted{app, write, drafts, source}`: the app's newest write, its open
 *   drafts and its release, which the directory answers as a read of the
 *   person (./person-lines.ts), again on each commit that touches the app:
 *   how the door knows its draft moved.
 *
 * @module
 */
import type { Bundle } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import type { VocabDoc } from '@yaks/vocab'
import type { Step } from '@yaks/builders/workflow'
import type { Made, Page } from './app-made.ts'
import { REACH } from './page-graph.ts'
import {
  type AppDraft,
  crossedPaths,
  draftPaths,
  editedAt,
} from './draft-choice.ts'
import type { Version } from './versions.ts'
import appCanvasJson from './vocab/app-canvas.vocab.json' with { type: 'json' }

/** An open draft as the app's writers see it. */
export type ShownDraft = {
  eid: string
  writers: string[]
  paths: string[]
  edited: string | null
  behind: boolean
  crossed: string[]
}

type Write = { path: string; at: string | null; by: string | null }

/** The app's draft author, or the writers remembered by the shared draft. */
export let draftAuthors = (draft: AppDraft, rows: Write[]) =>
  draft.by ? [draft.by] : [...new Set(rows.flatMap((w) => w.by ? [w.by] : []))]

/** Show the selected draft first, then the others by last edit. */
export let shownDrafts = (
  entries: { draft: AppDraft; rows: Write[] }[],
  names: ReadonlyMap<string, string>,
  versions: Version[],
  live: number | null,
  selected?: string,
): ShownDraft[] =>
  entries.map(({ draft, rows }) => {
    let paths = draftPaths(rows)
    return {
      eid: draft.eid,
      writers: draftAuthors(draft, rows).map((id) =>
        (names.get(id) ?? 'Unknown writer') +
        (draft.by && draft.via ? '’s agent' : '')
      ),
      paths,
      edited: editedAt(draft, rows),
      behind: !!draft.behind,
      crossed: crossedPaths(paths, draft.base, live, versions),
    }
  }).sort((a, b) =>
    Number(b.eid == selected) - Number(a.eid == selected) ||
    (b.edited ?? '').localeCompare(a.edited ?? '') ||
    a.eid.localeCompare(b.eid)
  )

/** What a writer asks to do with one of the drafts listed on the app. */
export type DraftAction = {
  app: string
  draft: string
  act: 'release' | 'discard'
}

export let DRAFT_PREVIEW = '/draft-preview'

export let draftPreview = (app: string, draft: string) =>
  `${REACH}${DRAFT_PREVIEW}?${new URLSearchParams({ app, draft })}`

/** What an app beside the chat is made of as it is being made: its kinds and
 * commands (./app-made.ts), its pages, its workflow stage by stage, and its
 * draft's preview link while the draft holds a page that is not live (before
 * the first release, and while changes wait for the next), with when that
 * draft was last written. */
export type Making = {
  made: Made
  pages: Page[]
  steps: Step[][]
  draft: string | null
  edited: string | null
  drafts?: ShownDraft[]
}

let MAKING = '.appMaking.app='

/** The line of what the app `eid` is made of. */
export let appMaking = (eid: string): string => MAKING + eid

/** The app an `appMaking` line asks about, or undefined for another line. */
export let makingApp = (line: string): string | undefined =>
  line.startsWith(MAKING) ? line.slice(MAKING.length) : undefined

let DRAFTED = '.appDrafted.app='

/** The line of where the app `eid`'s drafts stand. */
export let appDrafted = (eid: string): string => DRAFTED + eid

/** The app an `appDrafted` line asks about, or undefined for another line. */
export let draftedApp = (line: string): string | undefined =>
  line.startsWith(DRAFTED) ? line.slice(DRAFTED.length) : undefined

/** Where an app's drafts stand: the eid of its newest write, its open
 * drafts' eids, and its release. */
export type Drafted = {
  write: string | null
  drafts: string[]
  previews?: (string | null)[]
  source: string | null
}

/** Where the app `app`'s drafts stand, as `person`'s row. */
export let draftedRow = (
  person: string,
  app: string,
  drafted: Drafted,
): Bundle => ({
  entity: { eid: derivedEid(`app-drafted|${person}|${app}`) },
  appDrafted: { app, ...drafted },
})

export let appCanvasWords: VocabDoc = appCanvasJson as VocabDoc

/** What `person` may see of the app `app` being made, as its row. */
export let makingRow = (
  person: string,
  app: string,
  making: Making,
): Bundle => ({
  entity: { eid: derivedEid(`app-making|${person}|${app}`) },
  appMaking: { app, ...making },
})

/** What `rows` hold of the app `app` being made, if anything. */
export let makingOf = (rows: Bundle[], app: string): Making | undefined => {
  let row = rows.find((r) =>
    (r.appMaking as { app?: string } | undefined)?.app == app
  )?.appMaking as (Making & { app: string }) | undefined
  if (!row) return undefined
  let { made, pages, steps, draft, edited, drafts } = row
  return {
    made,
    pages,
    steps,
    draft: draft ?? null,
    edited: edited ?? null,
    drafts,
  }
}
