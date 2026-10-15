// Each release owes every app worker its wrapper: the directory's wrap row is
// seeded once with a daily pass, and each release brings that pass forward
// to now (rewrap.ts).
import type { Handlers } from '@yaks/effects'
import type { Options } from './store.ts'
import { seeded } from '../wake.ts'
import { DAILY, forward, ROW } from '../rewrap.ts'

export let effects = (_host: unknown, options: Options): Handlers => {
  let at = options.store
  if (!at.meta) return {}
  return {
    wrap_install: async () => {
      await seeded(at.graph, [{
        entity: { eid: ROW },
        wake: {
          every: DAILY,
          note: "Put this release's wrapper on app workers",
        },
        sweep: { kind: 'wrap' },
      }], Date.now())
      await at.graph.apply(
        forward(
          (await at.graph.read(`.entity.eid=${ROW} ?wake`))[0],
          Date.now(),
        ),
      )
    },
  }
}
