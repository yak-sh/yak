import { type Bundle, type Comp } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import { type Line, line } from '@yaks/query'
import { workRow } from './meter-graph.ts'
import type { WorkSpend } from './meter.ts'
import { type ByDay, summed } from '@yaks/ui/chart'

export const DIRECTORY_INDEX = 'yak/store/directory-index/1'
let RECEIPT = derivedEid(DIRECTORY_INDEX)

let legacyOf = (row: Bundle) =>
  (row.trend as Comp | undefined)?.people as Record<string, ByDay> | undefined

export let directoryIndexMove = {
  mark: DIRECTORY_INDEX as typeof DIRECTORY_INDEX,
  find:
    line`(.person|.space|.app|.referral)&.fields=directory_order.kind,space.slug,trend.people`,
  move: (row: Bundle, read?: (line: Line) => Bundle[]): Bundle[] => {
    // The write tracker indexes an untouched listing from its current rows.
    let order = (row.directory_order as Comp | undefined)?.kind
    let seed: Bundle[] = order ? [] : [{
      entity: row.entity,
      directory_order: { kind: 'pending' },
    }]
    let legacy = row.space && legacyOf(row)
    if (!legacy) return seed
    let space = row.entity.eid
    let existing = read!(line`.work_spend.space=${space}&.fields=work_spend`)
    let byPerson = new Map(existing.map((b) => {
      let work = b.work_spend as WorkSpend
      return [work.person, work.days]
    }))
    return [
      ...seed,
      {
        entity: row.entity,
        trend: { people: null },
      },
      ...Object.entries(legacy).flatMap(([person, days]) => {
        let had = byPerson.get(person)
        let merged = summed([had, days])
        if (!Object.keys(merged).length) return []
        return [workRow(space, person, merged)]
      }),
    ]
  },
  finish: () => [{ entity: { eid: RECEIPT }, directory_indexed: {} }],
}

// Every space the index has not counted since it began keeping `holds`: the
// same untouched-listing seed, so the write tracker counts it from its rows.
export let directoryHoldsMove = {
  mark: 'yak/store/directory-holds/1' as const,
  find: line`.space&!holds&.fields=directory_order.kind`,
  move: (row: Bundle): Bundle[] => [{
    entity: row.entity,
    directory_order: { kind: 'pending' },
  }],
}
