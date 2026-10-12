// The directory's wrap pass, fired by its wake row (rewrap.ts).
import type { Plugin } from '@yaks/graph'
import type { Options } from './store.ts'
import type { Env } from '../env.ts'
import { reporting } from '../wake.ts'
import { KERNEL, meta } from '../meta.ts'

// A pass that could not reach every script comes back this soon.
let AGAIN = 60_000

export let plugins = (_host: unknown, options: Options): Plugin[] => [{
  name: 'yak/wrap',
  admission: () => true,
  resources: {
    WrapEnv: () => options.store.meta ? options.store.env : undefined,
  },
  rules: [{
    name: 'wrap',
    phase: 'effect',
    match: '.wake, *fired, .sweep, sweep.kind=wrap, #WrapEnv',
    run: async (row) => {
      let env = row.WrapEnv as unknown as Env | undefined
      if (!env) return
      return await reporting(env, row, async () => {
        let { rewrapped } = await import('../rewrap.ts')
        let { rewrapped: n, failed, left } = await rewrapped(env)
        if (n || failed || left) {
          console.log(
            `yak-wrap: ${n} rewrapped, ${failed} failed, ${left} left`,
          )
        }
        if (!left) return
        await meta(env).apply([{
          entity: row.entity,
          wake: { at: new Date(Date.now() + AGAIN).toISOString() },
        }], KERNEL)
      })
    },
  }],
}]
