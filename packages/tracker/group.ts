// Grouping decides patches from records; graph admission commits them together.
// The occurrence link is the receipt: resends and retried effects never count twice.

import { type Bundle, derivedEid, type Graph, Stale, token } from '@yaks/graph'
import { absent, and, eq, every } from '@yaks/query'
import { faultKey } from './fault.ts'
import { enrichFrames } from './frames.ts'
import { comp, type Frame, str, title } from './model.ts'

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
export let regresses = (row: Bundle, bug: Bundle, before: Bundle[]): boolean =>
  !!bug.resolved && !!release(row) &&
  !before.some((old) => release(old) == release(row))

export let grouped = (
  row: Bundle,
  bug: Bundle | undefined,
  before: Bundle[],
): Bundle[] => {
  let e = comp(row, 'error')
  let x = comp(row, 'exception')
  let context = comp(row, 'during')
  let fault = str(e.fault) ||
    faultKey(str(context.kind), title(row), str(x.stack))
  let app = str(context.app)
  let eid = bug?.entity.eid ?? bugEid(app, fault)
  let old = comp(bug, 'bug')
  let at = str(e.at)
  let frames = Array.isArray(x.frames) ? x.frames as Frame[] : []
  let culprit = frames.find((f) => f.app && f.symbol)?.symbol
  let top = frames.find((f) => f.app) ?? frames[0]
  let back = !!bug && regresses(row, bug, before)
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
        hits: Number(old.hits ?? 0) + 1,
      },
      ...back
        ? {
          resolved: null,
          notified: null,
          wake: null,
          fired: null,
          regressed: { error: row.entity.eid },
        }
        : {},
    },
  ]
}

/** Existing groups can have migrated eids. New groups have deterministic ids;
 * guarded counters serialize competing workers without process-local locks. */
export let group = async (
  g: Graph,
  eid: string,
  enrich?: Enrich,
): Promise<void> => {
  let [row] = await g.get([eid])
  if (!row?.error || row.refusal || comp(row, 'error').bug) return
  let full = await (enrich ?? enrichFrames())(row)
  let fault = str(comp(full, 'error').fault) || faultKey(
    str(comp(full, 'during').kind),
    title(full),
    str(comp(full, 'exception').stack),
  )
  let app = str(comp(full, 'during').app)
  let [bug] = await g.read(
    and(
      eq('bug.fault', fault),
      app ? eq('bug.app', app) : absent('bug.app'),
      every(),
    ),
  )
  let before = bug
    ? await g.read(and(eq('error.bug', bug.entity.eid), every()))
    : []
  await g.apply(grouped(full, bug, before), { trusted: true })
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

export let trim = async (g: Graph, bug: string, count = 100): Promise<void> => {
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
  g: Graph,
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
    try {
      await g.apply(patch, { trusted: true })
      return
    } catch (error) {
      if (!(error instanceof Stale)) throw error
    }
  }
  throw Object.assign(new Error('frame inputs kept moving'), { retry: {} })
}
