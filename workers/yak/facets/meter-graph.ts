// The platform domain’s rules, composed through its graph facet.
import type { Plugin } from '@yaks/graph'
import type { Options } from './store.ts'
import type { Env } from '../env.ts'
import { reporting } from '../wake.ts'
import { added } from '../meter.ts'

let props = (c: unknown): Record<string, unknown> =>
  c && typeof c == 'object' ? Object.fromEntries(Object.entries(c)) : {}

export let plugins = (_host: unknown, options: Options): Plugin[] => [{
  name: 'yak/meter',
  admission: () => true,
  resources: {
    MeterEnv: () => options.store.meta ? options.store.env : undefined,
  },
  rules: [{
    name: 'meter',
    phase: 'effect',
    match: '.wake, *fired, .sweep, sweep.kind=meter, #MeterEnv, #Now',
    run: async (row) => {
      let { MeterEnv: env, Now } = row
      // Every store composes the rules; only the directory gets the bindings
      // that authorize a platform job, even if an app declares the same tags.
      if (!env) return
      return await reporting(env as unknown as Env, row, async () => {
        let { metered } = await import('../usage.ts')
        await metered(env as unknown as Env, new Date(Now.at))
      })
    },
  }, {
    // A spend, added to the month's meter inside the write's own transaction
    // and taken off again (vocab.ts `spend`): the sum is the directory's, never
    // a caller's, so two spends at once both count.
    name: 'spend',
    phase: 'rules',
    match: '+meter, *spend',
    run: ({ meter, spend }) => ({
      meter: added(props(meter), props(spend)),
      spend: null,
    }),
  }],
}]
