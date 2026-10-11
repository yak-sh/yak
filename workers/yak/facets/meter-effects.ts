// The directory’s hourly usage schedule, seeded once per deployment.
import type { Handlers } from '@yaks/effects'
import type { Options } from './store.ts'
import { seeded } from '../wake.ts'

export let effects = (_host: unknown, options: Options): Handlers => {
  let at = options.store
  if (!at.meta) return {}
  return {
    meter_install: async () => {
      await seeded(at.graph, [{
        entity: { eid: 'yak-meter' },
        wake: { every: '@hourly', note: 'Read yaks.app usage for this month' },
        sweep: { kind: 'meter' },
      }], Date.now())
    },
  }
}
