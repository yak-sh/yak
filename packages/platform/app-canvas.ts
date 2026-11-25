/**
 * What the app open beside the chat (./app-canvas-view.ts) is drawn from, as
 * the tab's page graph holds it (D-475 step 5):
 *
 * - the app's `sideApp` row (./side-rows.ts), which the side already watches:
 *   its name, its icon, and whether it is live, so the app's head and its
 *   live screens draw at once;
 * - `appMaking{app, made, pages, steps, draft}`: what it is made of, read
 *   from its draft as it stands, its workflow, and its draft's preview link.
 *   No store holds this: yaks.app's page graph door answers the line
 *   `appMaking(app)` by reading it, and reads it again as the app's draft,
 *   its row or its workflow moves.
 *
 * @module
 */
import type { Bundle } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import type { VocabDoc } from '@yaks/vocab'
import type { Step } from '@yaks/builders/workflow'
import type { Made, Page } from './app-made.ts'

/** What an app beside the chat is made of as it is being made: its kinds and
 * commands (./app-made.ts), its pages, its workflow stage by stage, and its
 * draft's preview link while the draft holds a page that is not live: before
 * the first release, and while changes wait for the next. */
export type Making = {
  made: Made
  pages: Page[]
  steps: Step[][]
  draft: string | null
}

let MAKING = '.appMaking.app='

/** The line of what the app `eid` is made of. */
export let appMaking = (eid: string): string => MAKING + eid

/** The app an `appMaking` line asks about, or undefined for another line. */
export let makingApp = (line: string): string | undefined =>
  line.startsWith(MAKING) ? line.slice(MAKING.length) : undefined

let list = { type: 'array' }

export let appCanvasWords: VocabDoc = {
  $defs: {
    appMaking: {
      component: true,
      type: 'object',
      properties: {
        app: { type: 'string' },
        made: { type: 'object' },
        pages: list,
        steps: list,
        draft: { type: ['string', 'null'] },
      },
      required: ['app', 'made', 'pages', 'steps'],
    },
  },
}

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
  let { made, pages, steps, draft } = row
  return { made, pages, steps, draft: draft ?? null }
}
