// The code behind rtc_lapse: a fired session lease closes its tracks at
// Realtime before its row is dropped. Failures reach the effect pool, so the
// lease stays available for another attempt.

import type { Handlers } from '@yaks/effects'
import { lapse, type Realtime } from './door.ts'

/** The same Realtime account the host lends the door. Credentials are read
 * on each attempt, so a config's secret references can rotate. */
export type Options = { realtime?: Realtime }

/** A host composes this facet beside the door's vocabulary. */
export let effects = (_host: unknown, options: Options = {}): Handlers => ({
  rtc_lapse: async (event, tx, write) => {
    let [row] = await tx.get([event.entity.eid], ['sfu', 'fired'])
    if (!row?.sfu || !row.fired) return
    let realtime = options.realtime
    if (!realtime?.app || !realtime.token) {
      throw new Error('@yaks/rtc — waiting for Realtime credentials')
    }
    await lapse(
      realtime,
      { write: async (bundles) => await write(bundles) },
      row,
    )
  },
})
