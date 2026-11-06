// The platform domain’s rules, composed through its graph facet.
import type { Plugin } from '@yaks/graph'
import type { Options } from './store.ts'
import type { Env } from '../env.ts'
import { reporting } from '../wake.ts'
import { added, trended, unaffordable } from '../meter.ts'
import { idOf, type Row, spaceOf, stamp } from '../directory.ts'
import { monthOf } from '../meter.ts'
import { Refused } from '@yaks/graph/errors'

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
    // Each month after the first that a space holds a number (numbers.ts
    // `number_buy`), its monthly price spent from the space's budget under
    // its texts. Never refused: the provider bills the platform for the month
    // whether or not the budget has room, so the spend counts all the same.
    name: 'lines',
    phase: 'effect',
    match: '.wake, *fired, .phone_line, #MeterEnv, #Now',
    run: async (row) => {
      let { MeterEnv: env, Now, phone_line: line } = row
      if (!env) return
      let { space, monthly } = props(line)
      if (!monthly) return
      await stamp(env as unknown as Env, {
        entities: [{
          entity: { eid: idOf(space as string) },
          spend: { month: monthOf(new Date(Now.at)), texts: Number(monthly) },
        }],
      })
    },
  }, {
    // A spend, added to the month's meter inside the write's own transaction
    // and taken off again (vocab.ts `spend`): the sum is the directory's, never
    // a caller's, so two spends at once both count. A held one is checked
    // against what is left of the month in that same transaction, so holds
    // made at once never spend past the budget together, and none waits on
    // another (model-spend.ts `reserved`).
    name: 'spend',
    phase: 'rules',
    // The space's plan and budget are read from its view, never named in the
    // match: a `+` there would give a space that has none an empty one.
    match: '+meter, +trend, *spend, #Now',
    run: (row) => {
      let { meter, trend, spend, Now } = row
      let said = props(spend)
      if (said.held) {
        if (!row.space) throw new Refused('The paying space is missing')
        let what: 'models' | 'realtime' | 'texts' =
          (['realtime', 'texts'] as const).find((k) => said[k]) ?? 'models'
        let no = unaffordable(
          spaceOf(row as unknown as Row),
          what,
          Number(said[what] ?? 0),
          new Date(Now.at),
          !!said.visitors,
        )
        if (no) {
          throw new Refused(no, {
            eid: (row.entity as { eid?: string } | undefined)?.eid,
            comp: 'spend',
            prop: what,
          })
        }
      }
      let { held: _, ...spent } = said
      return {
        meter: added(props(meter), spent),
        trend: trended(props(trend), spent, Date.parse(Now.at)),
        spend: null,
      }
    },
  }],
}]
