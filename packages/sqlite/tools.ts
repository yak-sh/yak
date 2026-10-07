// The check tools declared in ./vocab.json. The storage adapter supplies bound
// diagnostics; the portable host exposes no SQL driver. A storage adapter that
// supplies no diagnostics cannot establish a verdict, so its checks warn.

import type { Runs } from '@yaks/graph/tools'
import { checked, type Finding } from '@yaks/tools'

/** What configuration this package's checks accept. */
export type Options = {
  /** how many drifted entities to name (default 12) */
  sample?: number
}

let SAMPLE = 12

let unavailable = (diagnostic: string): Finding[] => [{
  level: 'warn',
  text: `this storage does not provide ${diagnostic} diagnostics, so this ` +
    'check is unavailable',
}]

/** The implementations behind the tools ./vocab.json declares, using the
 * calling application's bound storage diagnostics. */
export let runs = (
  host: {
    storage: {
      checks?: {
        storage(): Finding[]
        archetypes(sample: number): Finding[]
      }
    }
  },
  options: Options = {},
): Runs => ({
  storage_check: (call) =>
    checked(
      call.entity.eid,
      'the file holds no orphaned row and no broken reference',
      host.storage.checks?.storage() ?? unavailable('storage'),
    ),

  archetype_check: (call) =>
    checked(
      call.entity.eid,
      'every archetype pointer matches the components its owner carries',
      host.storage.checks?.archetypes(options.sample ?? SAMPLE) ??
        unavailable('archetype'),
    ),
})
