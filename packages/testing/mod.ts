/**
 * @yaks/testing — declare tests, check what they expect, and wait on facts.
 *
 * A test module declares its tests with `test` (or a `suite` of clauses),
 * each with tags a run can pick it by, and says what it expects with
 * `equal`, `ok`, `match` and `throws`:
 *
 * ```ts ignore
 * import { equal, suite, test } from '@yaks/testing'
 *
 * test('two and two', () => equal(2 + 2, 4))
 * suite('sum', ({ it, equal }) => {
 *   it('of nothing is zero', () => equal([].length, 0))
 * }, { tags: ['math'] })
 * ```
 *
 * `tick` yields one macrotask and `until` polls a fact, so a test waits on
 * what it expects instead of sleeping a guessed span:
 *
 * ```ts
 * import { until } from '@yaks/testing'
 *
 * let ready = false
 * setTimeout(() => ready = true)
 * await until(() => ready, { label: 'ready' })
 * ```
 *
 * @module
 */
export { equal, match, ok, throws } from './assert.ts'
export {
  type It,
  type Options,
  type Spec,
  suite,
  type Test,
  test,
} from './suite.ts'
export { tick, until, type Wait } from './wait.ts'
