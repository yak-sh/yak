import { relative } from '@yaks/ui/relative'
import { type Clock, system } from '@yaks/fp'
import { CallError } from '@yaks/tools/errors'

type Draft = { eid: string; at: string | null }
type Write = { path: string; at: string | null }

/** A named draft or the app's only open draft. */
let pick = <D extends Draft>(drafts: D[], asked?: string | null) =>
  asked
    ? drafts.find((d) => d.eid == asked)
    : drafts.length == 1
    ? drafts[0]
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
      let paths = [...new Set(writes.map((w) => w.path))].sort()
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
    if (picked || !asked && !drafts.length) return picked ?? null
    let [released, options] = await Promise.all([
      asked ? history.draftRelease(app, asked) : null,
      Promise.all(drafts.map(async (draft) => ({
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
    throw new CallError(
      'arguments',
      `${app.slug} has ${drafts.length} open drafts.\n${next}`,
    )
  }
