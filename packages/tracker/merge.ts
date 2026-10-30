// Consolidation keeps issued identities, historical counts and capture bytes.
import type { Bundle } from '@yaks/graph'
import { Stale } from '@yaks/graph/errors'
import { token } from '@yaks/graph/sha256'
import { comp, type Desk, str } from './model.ts'
import { stablePlace } from './fault.ts'

/** Follow a consolidated identity at the same boundary that reads its entity. */
export let survivor = async (
  g: Desk,
  eid: string,
): Promise<Bundle | undefined> => {
  let seen = new Set<string>()
  while (!seen.has(eid)) {
    seen.add(eid)
    let [row] = await g.get([eid])
    let into = str(comp(row, 'merged').into)
    if (!into) return row
    eid = into
  }
  throw Error(`merged identities form a cycle at ${eid}`)
}

let guard = (row: Bundle) =>
  Object.fromEntries(
    ['bug', 'resolved', 'archived', 'notified', 'taken'].map((name) => [
      name,
      Object.fromEntries(
        (name == 'bug' ? ['fault', 'hits', 'first', 'last'] : ['at']).map((
          key,
        ) => [key, token(comp(row, name)[key])]),
      ),
    ]),
  )
let first = (row: Bundle) => str(comp(row, 'bug').first)
let rank = (row: Bundle) => row.archived ? 2 : row.resolved ? 1 : 0
let ordered = (rows: Bundle[]) =>
  rows.toSorted((a, b) =>
    rank(a) - rank(b) || first(a).localeCompare(first(b)) ||
    a.entity.eid.localeCompare(b.entity.eid)
  )

/** One transaction per equivalent fault, including its occurrence receipts.
 * Prefer an open group, so consolidation never resolves or reopens a failure.
 * The survivor keeps its own resolution, task and correspondence. */
export let consolidation = (rows: Bundle[], errors: Bundle[]): Bundle[] => {
  let [kept, ...rest] = ordered(rows)
  let held = comp(kept, 'bug')
  let fault = stablePlace(str(held.fault))
  let notified = kept.notified ?? rows.find((r) => r.notified)?.notified
  return [
    {
      entity: kept.entity,
      $was: guard(kept),
      bug: {
        fault,
        spot: stablePlace(str(held.spot)) || null,
        hits: rows.reduce((n, r) => n + Number(comp(r, 'bug').hits ?? 0), 0),
        first: rows.map(first).sort()[0],
        last: rows.map((r) => str(comp(r, 'bug').last)).sort().at(-1),
      },
      ...notified ? { notified } : {},
    },
    ...rest.map((row): Bundle => ({
      entity: row.entity,
      $was: guard(row),
      bug: null,
      merged: { into: kept.entity.eid },
    })),
    ...errors.map((row): Bundle => ({
      entity: row.entity,
      $was: { error: { bug: token(comp(row, 'error').bug) } },
      error: { fault, bug: kept.entity.eid },
    })),
  ]
}

/** Repair groups whose only difference was a bundle's content hash. */
export let regroup = async (
  g: Desk,
): Promise<{ bugs: number; merged: number }> => {
  let rows = await g.read('.bug *')
  let groups = new Map<string, Bundle[]>()
  for (let row of rows) {
    let b = comp(row, 'bug')
    let key = JSON.stringify([b.app ?? '', stablePlace(str(b.fault))])
    groups.set(key, [...groups.get(key) ?? [], row])
  }
  let bugs = 0, merged = 0
  for (let rows of groups.values()) {
    if (
      !rows.some((r) =>
        stablePlace(str(comp(r, 'bug').fault)) != comp(r, 'bug').fault
      )
    ) continue
    let errors = (await Promise.all(rows.map((r) =>
      g.read(`.error.bug=${r.entity.eid} *`)
    ))).flat()
    try {
      await g.apply(consolidation(rows, errors), { trusted: true })
      bugs++
      merged += rows.length - 1
    } catch (error) {
      // A concurrent capture keeps every receipt; the next pass reads it anew.
      if (!(error instanceof Stale)) {
        throw error
      }
    }
  }
  return { bugs, merged }
}
