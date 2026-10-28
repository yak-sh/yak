// The Worker owns bug standing; the box owns its grouped evidence. Reconcile
// only marks on existing groups, never remote occurrences, counters or ids.
import { same } from '@yaks/fp'
import type { Bundle, Comp } from '@yaks/graph'
import { Stale } from '@yaks/graph/errors'
import { token } from '@yaks/graph/sha256'
import { absent, and, eq, every, limit, or, order, present } from '@yaks/query'
import { comp, type Desk, str } from './model.ts'
import type { Remote } from './remote.ts'
import { pages, signed, since } from './poll.ts'

let marks = ['resolved', 'archived', 'taken', 'regressed'] as const
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

/** One pass over the remote bugs (open and closed groups alike) that moved
 * since the last, through the poll's signed reads (./poll.ts `since`). A pass
 * that applied everything it read keeps the tag the remote stood at in
 * `seen`, and the next pass sends it: a remote where nothing moved since says
 * so with no row read, and one where something did names what moved, and
 * only those are read. The first pass, or one whose tag the remote no longer
 * knows what moved since, reads every bug. A raced local group is left for
 * the next pass, which asks again from the tag before it. A read refused
 * fails as the poll's does (./poll.ts `pages`), and the service decides what
 * the failure is (./outage.ts). */
export let reconcile = async (
  g: Desk,
  remote: Remote,
  go: typeof fetch = fetch,
  signal?: AbortSignal,
  seen: { tag?: string } = {},
): Promise<void> => {
  let page = pages(signed(remote, go), signal)
  let fresh = await since(page, '.bug *', seen.tag)
  if (!fresh) return
  let raced = false
  for (let row of fresh.rows) {
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
      raced = true
    }
  }
  if (!raced) seen.tag = fresh.tag
}
