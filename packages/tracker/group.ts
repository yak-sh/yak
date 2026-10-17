// Grouping decides patches from records; graph admission commits them together.
// The occurrence link is the receipt: resends and retried effects never count twice.

import type { Bundle, Comp } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import { Stale } from '@yaks/graph/errors'
import { token } from '@yaks/graph/sha256'
import { after, same } from '@yaks/fp'
import { absent, and, eq, every } from '@yaks/query'
import { faultOf } from './fault.ts'
import { enrichFrames } from './frames.ts'
import { comp, type Desk, type Frame, str, title } from './model.ts'

export type Enrich = (row: Bundle) => Bundle | Promise<Bundle>
export let bugEid = (app: string, fault: string): string =>
  derivedEid(`tracker-bug|${JSON.stringify([app, fault])}`)
export let release = (row: Bundle): string => {
  let e = comp(row, 'error')
  return e.commit
    ? `commit:${e.commit}`
    : e.version != null
    ? `version:${e.version}`
    : ''
}
let imported = (row: Bundle): boolean =>
  (comp(row, 'error').tags as Record<string, unknown> | undefined)?.migration ==
    'exception/1'

/** Only a group made wholly from imported samples inherits their lifecycle.
 * Each mark requires every sample; its latest historical stamp is retained. */
let migrationMarks = (rows: Bundle[]): Record<string, Comp | null> => {
  if (!rows.length || !rows.every(imported)) return {}
  return Object.fromEntries(['archived', 'notified', 'resolved'].map((name) => [
    name,
    rows.every((row) => row[name])
      ? rows.toSorted((a, b) =>
        str(comp(b, name).at).localeCompare(str(comp(a, name).at)) ||
        a.entity.eid.localeCompare(b.entity.eid)
      )[0][name] as Comp
      : null,
  ]))
}
let inherited = (row: Bundle, bug: Bundle | undefined, before: Bundle[]) => {
  if (!imported(row)) return {}
  let marks = migrationMarks([row, ...before])
  if (!bug) return marks
  let was = migrationMarks(before)
  // A person's later action belongs to the group, not to the imported samples.
  return Object.fromEntries(
    Object.entries(marks).filter(([name]) =>
      Object.hasOwn(was, name) && same(bug[name] ?? null, was[name])
    ),
  )
}
export let regresses = (row: Bundle, bug: Bundle, before: Bundle[]): boolean =>
  !imported(row) && !!bug.resolved &&
  str(comp(row, 'error').at) > str(comp(bug, 'resolved').at) &&
  !!release(row) && !before.some((old) => release(old) == release(row))

export let grouped = (
  row: Bundle,
  bug: Bundle | undefined,
  before: Bundle[],
): Bundle[] => {
  let e = comp(row, 'error')
  let x = comp(row, 'exception')
  let context = comp(row, 'during')
  let fault = faultOf(row)
  let app = str(context.app)
  let eid = bug?.entity.eid ?? bugEid(app, fault)
  let old = comp(bug, 'bug')
  let at = str(e.at)
  let frames = Array.isArray(x.frames) ? x.frames as Frame[] : []
  let culprit = frames.find((f) => f.app && f.symbol)?.symbol
  let top = frames.find((f) => f.app) ?? frames[0]
  let back = !!bug && regresses(row, bug, before)
  let marks = inherited(row, bug, before)
  return [
    {
      ...row,
      $was: { error: { bug: null } },
      error: { ...e, fault, bug: eid },
    },
    {
      entity: { eid },
      $was: {
        bug: { hits: token(old.hits) },
        resolved: { at: token(comp(bug, 'resolved').at) },
        ...Object.fromEntries(
          Object.keys(marks).map((name) => [
            name,
            Object.fromEntries(
              ['at', 'by', 'via'].map((
                prop,
              ) => [prop, token(comp(bug, name)[prop])]),
            ),
          ]),
        ),
      },
      ...!bug ? { doc: { title: title(row) } } : {},
      bug: {
        ...!bug
          ? {
            fault,
            ...(app ? { app } : {}),
            first: at,
            ...culprit ? { culprit, spot: null } : top
              ? {
                spot: `${top.file}${top.line ? `:${top.line}` : ''}${
                  top.function ? ` ${top.function}` : ''
                }`,
              }
              : {},
          }
          : {},
        first: str(old.first) && str(old.first) < at ? old.first : at,
        last: str(old.last) > at ? old.last : at,
        hits: Number(old.hits ?? 0) + Number(e.hits ?? 1),
      },
      ...marks,
      ...back
        ? {
          resolved: null,
          notified: null,
          regressed: { at: null, by: null, via: null, error: row.entity.eid },
        }
        : {},
    },
  ]
}

/** Existing groups can have migrated eids. New groups have deterministic ids;
 * guarded counters serialize competing workers without process-local locks.
 * Contention rebases here, without spending the effect's failure attempts. */
export let group = async (
  g: Desk,
  eid: string,
  enrich?: Enrich,
): Promise<void> => {
  for (;;) {
    let [row] = await g.get([eid])
    if (!row?.error || row.refusal || comp(row, 'error').bug) return
    let full = await (enrich ?? enrichFrames())(row)
    let fault = faultOf(full)
    let app = str(comp(full, 'during').app)
    try {
      // Local reads and admission stay in one turn. Other processes still
      // compete through the guards, and a lost claim rereads its receipt too.
      await after(
        g.read(and(
          eq('bug.fault', fault),
          app ? eq('bug.app', app) : absent('bug.app'),
          every(),
        )),
        ([bug]) =>
          after(
            bug ? g.read(and(eq('error.bug', bug.entity.eid), every())) : [],
            (before) => g.apply(grouped(full, bug, before), { trusted: true }),
          ),
      )
      return
    } catch (error) {
      if (!(error instanceof Stale)) throw error
    }
  }
}

/** Newest hundred, plus the first occurrence of each release. */
export let retained = (rows: Bundle[], count = 100): Set<string> => {
  let sorted = [...rows].sort((a, b) =>
    str(comp(a, 'error').at).localeCompare(str(comp(b, 'error').at)) ||
    a.entity.eid.localeCompare(b.entity.eid)
  )
  let keep = new Set(sorted.slice(-count).map((b) => b.entity.eid))
  let seen = new Set<string>()
  for (let row of sorted) {
    let key = release(row)
    if (!key || seen.has(key)) continue
    seen.add(key)
    keep.add(row.entity.eid)
  }
  return keep
}

export let trim = async (g: Desk, bug: string, count = 100): Promise<void> => {
  let rows = await g.read(and(eq('error.bug', bug), every()))
  let keep = retained(rows, count)
  let gone = rows.filter((b) => !keep.has(b.entity.eid))
  if (gone.length) {
    await g.apply(
      gone.map((b) => ({
        entity: b.entity,
        $delete: true,
      })),
      { trusted: true },
    )
  }
}

/** A frame resolver's own failure remains grouped text, not another catalog job.
 * Reporting still records terminal failures; it cannot feed enrichment itself. */
export let frameable = (row: Bundle | undefined): row is Bundle => {
  let tags = comp(row, 'error').tags
  return !!row?.error && !!row.exception && !!comp(row, 'error').bug &&
    !(tags && typeof tags == 'object' &&
      'handler' in tags && tags.handler == 'error_frames')
}

let inputs = (row: Bundle) => ({
  error: { commit: token(comp(row, 'error').commit) },
  exception: {
    stack: token(comp(row, 'exception').stack),
    frames: token(comp(row, 'exception').frames),
  },
})

/** Catalog awaits cannot freeze the group or the source. Re-read both before
 * committing and keep guards through admission; contention never recounts. */
export let reframe = async (
  g: Desk,
  eid: string,
  enrich: Enrich,
): Promise<void> => {
  for (let tries = 0; tries < 3; tries++) {
    let [source] = await g.get([eid])
    if (!frameable(source)) return
    let full = await enrich(source)
    let frames = comp(full, 'exception').frames
    if (!Array.isArray(frames)) return
    let [row] = await g.get([eid])
    if (!frameable(row)) return
    if (JSON.stringify(inputs(source)) != JSON.stringify(inputs(row))) continue
    let bug = str(comp(row, 'error').bug)
    let patch: Bundle[] = [{
      entity: row.entity,
      $was: {
        ...inputs(row),
        error: { ...inputs(row).error, bug: token(bug) },
      },
      exception: { frames },
    }]
    let culprit = frames.find((f) => f.app && f.symbol)?.symbol
    let top = frames.find((f) => f.app) ?? frames[0]
    let [known] = await g.get([bug])
    if (known?.bug && !comp(known, 'bug').culprit && (culprit || top)) {
      patch.push({
        entity: { eid: bug },
        $was: {
          bug: {
            culprit: token(comp(known, 'bug').culprit),
            spot: token(comp(known, 'bug').spot),
          },
        },
        bug: culprit ? { culprit, spot: null } : {
          spot: `${top.file}${top.line ? `:${top.line}` : ''}${
            top.function ? ` ${top.function}` : ''
          }`,
        },
      })
    }
    // A start-up recheck mostly finds what is already written.
    let same = JSON.stringify(frames) ==
      JSON.stringify(comp(row, 'exception').frames)
    if (same && patch.length == 1) return
    try {
      await g.apply(patch, { trusted: true })
      return
    } catch (error) {
      if (!(error instanceof Stale)) throw error
    }
  }
  throw Object.assign(new Error('frame inputs kept moving'), { retry: {} })
}
