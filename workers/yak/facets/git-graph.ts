// The platform domain’s rules, composed through its graph facet.
import type { Plugin } from '@yaks/graph'
import type { Options } from './store.ts'
import type { Env } from '../env.ts'
import { reporting } from '../wake.ts'
import { meta } from '../meta.ts'

export let plugins = (_host: unknown, options: Options): Plugin[] => [{
  name: 'yak/git',
  admission: () => true,
  resources: {
    GitEnv: () => options.store.meta ? options.store.env : undefined,
  },
  rules: [{
    name: 'git',
    phase: 'effect',
    match: '.wake, *fired, .sweep, sweep.kind=git, #GitEnv',
    run: async (row) => {
      let env = row.GitEnv
      if (!env) return
      let bound = env as unknown as Env
      return await reporting(bound, row, async () => {
        let { backfilled, held } = await import('../gitobj.ts')
        let made = await backfilled(bound, held(meta(bound)))
        if (made) console.log(`yak-git: ${made} deploys committed`)
      })
    },
  }],
}]
