// The directory's refusal reports (refusals.ts), counted when the hourly wake
// fires. Each is a platform letter, which the pool sends (@yaks/mail). The
// same firing forgets the occurrences delivered letters counted long ago.
import type { Comp } from '@yaks/graph'
import type { Handlers } from '@yaks/effects'
import type { Options } from './store.ts'
import { forgotten, reported } from '../refusals.ts'

export let effects = (_host: unknown, options: Options): Handlers => {
  let at = options.store
  if (!at.meta) return {}
  return {
    report_refusals: async (event, tx) => {
      let [row] = await tx.get([event.entity.eid])
      let fired = (row?.fired as Comp | undefined)?.at
      if (!fired) return
      await reported(at.graph, String(fired))
      await forgotten(at.graph, String(fired))
    },
  }
}
