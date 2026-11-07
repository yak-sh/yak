// A space a budget hold gave an empty plan, comped, budget or starter loses it
// again (T-141144): cc1e76f7f's `spend` rule named them with `+` in its match,
// which ensures a component, so a hold on a space without one wrote it with
// nothing in it. Each is dropped only while it holds none of its properties.
// Only the directory holds spaces.
import type { Bundle } from '@yaks/graph'
import { PLATFORM_STORE } from '@yaks/platform/names'
import type { Rule } from './mover.ts'

let EMPTY: Record<string, string[]> = {
  plan: ['tier', 'customer', 'subscription', 'status', 'until', 'ending', 'at'],
  comped: ['until'],
  budget: ['dollars'],
  starter: ['dollars'],
}

let empty = (row: Bundle, comp: string) => {
  let held = row[comp] as Record<string, unknown> | null | undefined
  return !!held && EMPTY[comp].every((p) => held[p] == null)
}

export let holdEmptyRule: Rule = {
  mark: 'yak/store/hold-empty/1',
  stores: [PLATFORM_STORE],
  live: 'all',
  find:
    Object.entries(EMPTY).map(([comp, props]) =>
      `(.space&.${comp}${props.map((p) => `&!${comp}.${p}`).join('')})`
    ).join('|') + '&*',
  move: (row) => {
    let gone = Object.keys(EMPTY).filter((c) => empty(row, c))
    return gone.length
      ? [{
        entity: { eid: row.entity.eid },
        ...Object.fromEntries(gone.map((c) => [c, null])),
      }]
      : []
  },
}
