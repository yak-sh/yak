import { relative } from '@yaks/ui/relative'
import { type Clock, system } from '@yaks/fp'
import { CallError } from '@yaks/tools/errors'
import type { Version } from './versions.ts'

/** An open draft, including a legacy draft still named by the app row. */
export type AppDraft = {
  eid: string
  base: number | null
  by: string | null
  via: string | null
  at: string | null
  /** When its preview was first requested, and the branch that preview uses. */
  previewed: string | null
  branch: number | null
  legacy?: true
  /** The live version went out after it was last worked in (written.ts
   * `marked`): an option a release did not take, or work a release overtook.
   * It stays open, and only a call that names it works in it. Read, never
   * stored. */
  behind?: true
}

/** Keep a draft named by older app rows until it has a row of its own. */
export let withLegacy = (
  app: { draft?: string | null; version: number | null },
  rows: AppDraft[],
): AppDraft[] =>
  app.draft && !rows.some((d) => d.eid == app.draft)
    ? [...rows, {
      eid: app.draft,
      base: app.version,
      by: null,
      via: null,
      at: null,
      previewed: null,
      branch: null,
      legacy: true,
    }]
    : rows

type Draft = Pick<AppDraft, 'eid' | 'at' | 'behind'>
type Write = { path: string; at: string | null }

/** When the draft was last written, or when it opened. */
export let editedAt = (draft: Draft, writes: Write[]) =>
  writes.reduce<string | null>(
    (at, w) => w.at && (!at || w.at > at) ? w.at : at,
    null,
  ) ?? draft.at

/** The paths a draft wrote, including paths it deleted. */
export let draftPaths = (writes: Pick<Write, 'path'>[]) =>
  [...new Set(writes.map((w) => w.path))].sort()

/** Paths the draft wrote that differ between its base and live. */
export let crossedPaths = (
  paths: string[],
  base: number | null,
  live: number | null,
  versions: Version[],
) => {
  if (live == null || (base ?? 0) >= live) return []
  let before = base ? versions.find((v) => v.version == base)?.files : {}
  let after = versions.find((v) => v.version == live)?.files
  return before && after ? paths.filter((p) => before[p] != after[p]) : []
}

/** The drafts a call that names none may land in: every open draft but
 * those a release left behind. */
export let current = <D extends Draft>(drafts: D[]) =>
  drafts.filter((d) => !d.behind)

/** A named draft or the app's only current one. */
let pick = <D extends Draft>(drafts: D[], asked?: string | null) =>
  asked
    ? drafts.find((d) => d.eid == asked)
    : current(drafts).length == 1
    ? current(drafts)[0]
    : undefined

/** One line per open draft, with its age and the paths it edited. */
let optionsOf = (drafts: { draft: Draft; writes: Write[] }[], now: number) =>
  [
    "Pass draft: '<id>' to choose an open draft.",
    ...drafts.map(({ draft, writes }) => {
      let first = writes.reduce<string | null>(
        (at, w) => w.at && (!at || w.at < at) ? w.at : at,
        null,
      )
      let age = relative(draft.at ?? first, now) || 'age unknown'
      let paths = draftPaths(writes)
      return `- ${draft.eid} · ${age} · ${
        paths.join(', ') || 'no files changed'
      }`
    }),
  ].join('\n')

export let WRITE_DRAFT = 'An app_files write without draft opens a new draft.'

/** Recovery when a named draft has closed. Older releases may lack its id. */
let closed = (
  app: string,
  asked: string,
  live: number | null,
  released: number | null,
) =>
  (released == null
    ? `No open draft ${asked} for ${app}. It may have been released or discarded.`
    : `Draft ${asked} of ${app} was released as v${released}.`) +
  (live
    ? ` The live version is v${live}.`
    : ' The app has no live version yet.')

type App = { slug: string; version: number | null }

/** Recovery for a deploy whose draft has closed. */
export let deployDraftRefusal = (
  app: App,
  asked: string,
  drafts: Draft[],
  released: number | null,
): CallError => {
  let open = current(drafts)
  let next = open.length == 1
    ? `The current draft is ${open[0].eid}. Retry app_deploy with draft: '${
      open[0].eid
    }' to release it.`
    : drafts.length
    ? `To release an open draft, retry app_deploy with its id as draft. Open drafts: ${
      (open.length ? open : drafts).map((d) => d.eid).join(', ')
    }.`
    : 'There are no open drafts, so nothing waits to release. To change ' +
      'the app, write the change with app_files first, without draft: that ' +
      'opens a new draft, and app_deploy with its id releases it.'
  return new CallError(
    'missing',
    closed(app.slug, asked, app.version, released),
    next,
  )
}

/** Recovery for a requested live preview before the first release. */
export let firstPreview = (app: string, drafts: Draft[] | null): string =>
  `${app} has no release yet. ` +
  (drafts == null
    ? 'An editor can preview its draft with app_preview and released: false.'
    : drafts.length
    ? `Preview ${
      drafts.length == 1 ? 'the private draft' : 'a private draft'
    } with app_preview. Use released: false and set draft to ` +
      drafts.map((d) => `'${d.eid}'`).join(' or ') +
      '. Call app_deploy with that draft when it is ready for its first release.'
    : 'Use app_files to write a draft, then call app_preview with released: false.')

/** How to recover an app in the trash that still holds open drafts. */
export let restoreDrafts = (
  space: string,
  app: App & { eid: string },
  ids: string[],
) =>
  `${space}/${app.slug} is in the trash${
    app.version ? '' : ' and has no live version'
  }. It still has open drafts ${ids.join(', ')}. ` +
  'An editor can restore it with this call.\n' +
  `app_restore ${JSON.stringify({ space, app: app.eid })}`

type History<A> = {
  draftRelease: (app: A, draft: string) => Promise<number | null>
  written: (app: A, draft: string) => Promise<Write[]>
}

/** The draft app_files and app_preview use. Only a refusal reads history. */
export let toolDraft =
  (asked?: string | null, clock: Clock = system) =>
  async <A extends App, D extends Draft>(
    history: History<A>,
    app: A,
    drafts: D[],
  ) => {
    let picked = pick(drafts, asked)
    if (picked || !asked && !current(drafts).length) return picked ?? null
    // An unnamed call chooses among the current drafts; a named one that
    // closed is shown every open draft, behind or not.
    let among = asked ? drafts : current(drafts)
    let [released, options] = await Promise.all([
      asked ? history.draftRelease(app, asked) : null,
      Promise.all(among.map(async (draft) => ({
        draft,
        writes: await history.written(app, draft.eid),
      }))),
    ])
    let next = options.length
      ? optionsOf(options, clock.now())
      : 'There are no open drafts. Omit draft to read live files with app_files. ' +
        WRITE_DRAFT
    if (asked) {
      throw new CallError(
        'missing',
        `${closed(app.slug, asked, app.version, released)}\n${next}`,
      )
    }
    let live = app.version ? '' : ' The app has no live version yet.'
    throw new CallError(
      'arguments',
      `${app.slug} has ${among.length} open drafts.${live}\n${next}`,
    )
  }
