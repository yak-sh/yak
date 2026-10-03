// A call's outcome comes from its interruption and explicitly named answers.
// The bundle rule and SQL expression describe the same facts.

import type { Bundle, Comp } from '@yaks/graph'
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
  or,
  select,
  table,
  when,
} from '@yaks/sql'

let component = (b: Bundle, name: string): Comp | undefined =>
  typeof b[name] == 'object' && b[name] != null ? b[name] as Comp : undefined

export let executionState = (
  call: Bundle,
  answers: readonly Bundle[] = [],
): 'interrupted' | 'failed' | 'done' | 'running' | null => {
  if (!call.execution) return null
  if (call.interrupted) return 'interrupted'
  let own = answers.filter((b) =>
    component(b, 'output')?.source == call.entity.eid ||
    component(b, 'result')?.call == call.entity.eid
  )
  return own.some((b) => b.refusal || b.exception)
    ? 'failed'
    : own.some((b) => b.result)
    ? 'done'
    : component(call, 'execution')?.by != null
    ? 'running'
    : null
}

export let executionDerived = (vocab: Vocab): Derived => {
  let has = (name: string, owner: Expr, prop = 'entity') =>
    vocab.comp(name)
      ? exists(select({
        cols: [lit(1)],
        from: table(name, 's'),
        where: eq(col(prop, 's'), owner),
      }))
      : lit(false)
  let named = (owner: Expr, field: string, comp: string): Expr =>
    vocab.comp(comp)
      ? exists(select({
        cols: [lit(1)],
        from: table(comp, 'a'),
        where: and(
          eq(col(field, 'a'), owner),
          or(
            has('refusal', col('entity', 'a')),
            has('exception', col('entity', 'a')),
          ),
        ),
      }))
      : lit(false)
  return {
    'execution.state': {
      tag: 'text',
      values: ['interrupted', 'failed', 'done', 'running'],
      deps: ['execution'],
      expr: (owner) =>
        when(
          [
            [has('interrupted', owner), lit('interrupted')],
            [
              or(
                named(owner, 'source', 'output'),
                named(owner, 'call', 'result'),
              ),
              lit('failed'),
            ],
            [has('result', owner, 'call'), lit('done')],
            [
              exists(
                select({
                  cols: [lit(1)],
                  from: table('execution', 's'),
                  where: and(
                    eq(col('entity', 's'), owner),
                    notNull(col('by', 's')),
                  ),
                }),
              ),
              lit('running'),
            ],
          ],
          lit(null),
        ),
    },
  }
}

export let executionComputed: Computed = {
  'execution.state': (call, among) => executionState(call, among.list),
}

/** Work cut off deliberately, not a refusal or a defect. */
export class Interrupted extends Error {
  code: string
  constructor(message: string, code = 'aborted') {
    super(message)
    this.name = 'Interrupted'
    this.code = code
  }
}
