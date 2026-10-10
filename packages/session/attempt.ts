// A provider request is held while in flight, completed when released, or
// interrupted explicitly. No diagnostic code decides its lifecycle.

import type { Computed } from '@yaks/match'
import type { Vocab } from '@yaks/vocab'
import {
  and,
  col,
  type Derived,
  eq,
  exists,
  type Expr,
  lit,
  notNull,
  select,
  table,
  when,
} from '@yaks/sql'

import { attemptState } from './state.ts'
export { attemptState } from './state.ts'

export let attemptDerived = (vocab: Vocab): Derived => ({
  'attempt.state': {
    tag: 'text',
    values: ['interrupted', 'inflight', 'completed'],
    deps: ['attempt'],
    expr: (owner: Expr) =>
      when(
        [
          ...vocab.comp('interrupted')
            ? [[
              exists(select({
                cols: [lit(1)],
                from: table('interrupted', 's'),
                where: eq(col('entity', 's'), owner),
              })),
              lit('interrupted'),
            ] as [Expr, Expr]]
            : [],
          [
            exists(select({
              cols: [lit(1)],
              from: table('attempt', 's'),
              where: and(
                eq(col('entity', 's'), owner),
                notNull(col('by', 's')),
              ),
            })),
            lit('inflight'),
          ],
        ],
        lit('completed'),
      ),
  },
})

export let attemptComputed: Computed = {
  'attempt.state': (ask) => ask.attempt ? attemptState(ask) : null,
}
