// The directory's kill sweep, fired by its wake row (kills.ts). Each run reads
// on from where the last one finished, which the row keeps as `sweep.through`.
import type { Plugin } from '@yaks/graph'
import type { Options } from './store.ts'
import type { Env } from '../env.ts'
import { reporting } from '../wake.ts'
import { KERNEL, meta } from '../meta.ts'

export let plugins = (_host: unknown, options: Options): Plugin[] => [{
  name: 'yak/kills',
  admission: () => true,
  resources: {
    KillsEnv: () => options.store.meta ? options.store.env : undefined,
  },
  rules: [{
    name: 'kills',
    phase: 'effect',
    match: '.wake, *fired, .sweep, sweep.kind=kills, #KillsEnv, #Now',
    run: async (row) => {
      let env = row.KillsEnv as unknown as Env | undefined
      if (!env) return
      return await reporting(env, row, async () => {
        let { swept } = await import('../kills.ts')
        let sweep = row.sweep as { through?: string | null }
        let through = await swept(env, sweep.through, Date.parse(row.Now.at))
        if (!through) return
        await meta(env).apply(
          [{ entity: row.entity, sweep: { through } }],
          KERNEL,
        )
      })
    },
  }],
}]
