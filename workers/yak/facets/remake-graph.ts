// The directory's remake sweep, fired by a release's remake row (remake.ts).
import type { Plugin } from '@yaks/graph'
import type { Options } from './store.ts'
import type { Env } from '../env.ts'
import type { Remake } from '../remake.ts'
import { reporting } from '../wake.ts'

export let plugins = (_host: unknown, options: Options): Plugin[] => [{
  name: 'yak/remake',
  admission: () => true,
  resources: {
    RemakeEnv: () => options.store.meta ? options.store.env : undefined,
  },
  rules: [{
    name: 'remake',
    phase: 'effect',
    match:
      '.wake, *fired, .sweep, sweep.kind=remake, .release_remake, #RemakeEnv',
    run: async (row) => {
      let env = row.RemakeEnv as unknown as Env | undefined
      if (!env) return
      return await reporting(env, row, async () => {
        let { remade } = await import('../remake.ts')
        await remade(env, row.release_remake as Remake)
      })
    },
  }],
}]
