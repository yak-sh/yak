// What changed in a watched design family, by the design's own name. Store
// stamps and unrelated components do not make terrain or models stale.
import { comp, str } from './bundle.ts'
import type { Bundle } from './net.ts'

export let changed = (
  before: Bundle[],
  after: Bundle[],
  component: string,
  name: string,
): Set<string> => {
  let named = (rows: Bundle[]) =>
    new Map(rows.flatMap((row) => {
      let design = comp(row, component), id = str(design[name])
      return id ? [[id, JSON.stringify(design)] as [string, string]] : []
    }))
  let old = named(before), now = named(after)
  return new Set(
    [...old.keys(), ...now.keys()].filter((id) => old.get(id) != now.get(id)),
  )
}
