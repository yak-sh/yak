// The platform domain’s rules, composed through its graph facet.
import type { Plugin } from '@yaks/graph'
import type { Options } from './store.ts'
import type { Env } from '../env.ts'
import { reporting } from '../wake.ts'

export let plugins = (_host: unknown, options: Options): Plugin[] => [{
  name: 'yak/trash',
  admission: () => true,
  resources: {
    TrashEnv: () => options.store.meta ? options.store.env : undefined,
  },
  // The write’s own clock and vouched actor stamp a fresh trash mark.
  // An already dated mark is left intact, including a migration’s byline.
  rules: [{
    name: 'trashed',
    phase: 'stamp',
    match: '*trashed, !trashed.at, #Actor, #Now',
    run: ({ Actor, Now }) => ({ trashed: { at: Now, by: Actor } }),
  }, {
    name: 'trash',
    phase: 'effect',
    match: '.wake, *fired, .sweep, sweep.kind=trash, #TrashEnv, #Now',
    run: async (row) => {
      let { TrashEnv: env, Now } = row
      if (!env) return
      return await reporting(env as unknown as Env, row, async () => {
        let { collected } = await import('../erase.ts')
        await collected(env as unknown as Env, new Date(Now.at))
      })
    },
  }],
}]
