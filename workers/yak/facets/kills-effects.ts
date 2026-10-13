// The directory's kill sweep schedule, seeded once per deployment.
import type { Handlers } from '@yaks/effects'
import type { Options } from './store.ts'
import { seeded } from '../wake.ts'
import { EVERY } from '../kills.ts'

export let effects = (_host: unknown, options: Options): Handlers => {
  let at = options.store
  if (!at.meta) return {}
  return {
    kills_install: async () => {
      await seeded(at.graph, [{
        entity: { eid: 'yak-kills' },
        wake: {
          every: EVERY,
          note: 'Report what the runtime killed for its limits',
        },
        sweep: { kind: 'kills' },
      }], Date.now())
    },
  }
}
