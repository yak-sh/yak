// The Worker owns bug standing; the box owns its grouped evidence. Reconcile
// only marks on existing groups, never remote occurrences, counters or ids.
import { same } from '@yaks/fp'
import type { Bundle, Comp } from '@yaks/graph'
import { Stale } from '@yaks/graph/errors'
import { token } from '@yaks/graph/sha256'
import { absent, and, eq, every, limit, or, order, present } from '@yaks/query'
import { comp, type Desk, str } from './model.ts'
import { type Remote, request } from './remote.ts'

let marks = ['resolved', 'archived', 'taken', 'regressed', 'deployed'] as const
let app = (row: Bundle) => str(comp(row, 'bug').app ?? comp(row, 'during').app)

/** Global ids survive transport; older migrated groups instead share fault
 * and app. A missing fault is not a grouping key. */
export let matches = (local: Bundle, remote: Bundle): boolean =>
  !!local.bug && !!remote.bug && (local.entity.eid == remote.entity.eid ||
    !!comp(remote, 'bug').fault &&
      comp(local, 'bug').fault == comp(remote, 'bug').fault &&
      app(local) == app(remote))

/** A guarded, minimal standing patch, with removed explanation properties
 * explicitly cleared. New local evidence must not be closed by an older
 * remote snapshot, nor lose the regression that evidence just established. */
export let standing = (local: Bundle, remote: Bundle): Bundle | undefined => {
  if (!matches(local, remote)) return
  let newer = str(comp(local, 'bug').last) > str(comp(remote, 'bug').last)
  let patch: Bundle = {
    entity: { eid: local.entity.eid },
    $was: {
      bug: { last: token(comp(local, 'bug').last) },
      resolved: { at: token(comp(local, 'resolved').at) },
    },
  }
  let changed = false
  for (let name of marks) {
    if (
      newer && (name == 'regressed' || name == 'resolved' && remote.resolved)
    ) {
      continue
    }
    let before = local[name] as Comp | undefined
    let after = remote[name] as Comp | undefined
    if (same(before ?? null, after ?? null)) continue
    changed = true
    patch[name] = after
      ? {
        ...Object.fromEntries(Object.keys(before ?? {}).map((k) => [k, null])),
        ...after,
      }
      : null
    patch.$was![name] = Object.fromEntries(
      [
        ...new Set([
          'at',
          ...Object.keys(before ?? {}),
          ...Object.keys(after ?? {}),
        ]),
      ]
        .map((key) => [key, token(before?.[key])]),
    )
  }
  return changed ? patch : undefined
}

const PAGE = 100, PAGES = 100

/** One bounded pass through remote bugs (including open and closed groups).
 * Each page uses the existing signed read transport. A raced local group is
 * left for the next pass; failures propagate to the service's health report. */
export let reconcile = async (
  g: Desk,
  remote: Remote,
  go: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<void> => {
  let cursor = ''
  for (let page = 0; page < PAGES; page++) {
    signal?.throwIfAborted()
    let response = await request(
      remote,
      'bugs',
      new URLSearchParams({
        scope: 'platform',
        limit: String(PAGE),
        query: `.bug * .order=entity.eid${cursor ? ` .after=${cursor}` : ''}`,
      }),
      { signal },
      go,
    )
    if (!response.ok) {
      await response.body?.cancel()
      throw Error(`Remote tracker refused reconciliation (${response.status})`)
    }
    let rows: Bundle[] = await response.json()
    if (
      !Array.isArray(rows) || rows.length > PAGE ||
      rows.some((row) =>
        !row?.bug || typeof row.entity?.eid != 'string' ||
        row.entity.eid <= cursor
      )
    ) throw Error('Remote tracker returned an invalid reconciliation page')
    let next = rows.at(-1)?.entity.eid
    if (
      rows.some((row, i) => i > 0 && row.entity.eid <= rows[i - 1].entity.eid)
    ) {
      throw Error('Remote tracker reconciliation did not advance')
    }
    for (let row of rows) {
      signal?.throwIfAborted()
      let [local] = await g.get([row.entity.eid])
      if (!local?.bug) {
        let fault = str(comp(row, 'bug').fault)
        if (!fault) continue
        let scope = app(row)
        let candidates = await g.read(and(
          present('bug'),
          eq('bug.fault', fault),
          scope
            ? or(
              eq('bug.app', scope),
              and(absent('bug.app'), eq('during.app', scope)),
            )
            : and(absent('bug.app'), absent('during.app')),
          every(),
          order('entity.eid'),
          limit(2),
        ))
        // Ambiguous historical groups are not evidence that either is this bug.
        if (candidates.length != 1) continue
        local = candidates[0]
      }
      let patch = standing(local, row)
      if (!patch) continue
      try {
        await g.apply([patch], { trusted: true, stamp: false })
      } catch (error) {
        if (!(error instanceof Stale)) throw error
      }
    }
    if (rows.length < PAGE) return
    cursor = next!
  }
  throw Error('Remote tracker reconciliation exceeded 100 pages')
}
