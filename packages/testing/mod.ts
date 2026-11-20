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
 * `lend` sets a global, such as `document`, until it is put back, over one
 * another module installed read-only.
 *
 * `typist` keeps a text field's caret as a browser does, on a DOM that keeps
 * none, and types at it as a person does.
 *
 * The runner, `@yaks/testing/main`, loads test modules and the examples
 * beside the code into one runtime and runs them.
 *
 * @module
 */
export { equal, match, ok, throws } from './assert.ts'
export { type Clock, clock } from './clock.ts'
export {
  afterAll,
  cleanup,
  type It,
  kept,
  type Options,
  type Spec,
  suite,
  type Test,
  test,
} from './suite.ts'
export { lend } from './lend.ts'
export { type Looks, own, waits } from './own.ts'
export { type Typist, typist } from './typist.ts'
export { tick, until, type Wait } from './wait.ts'
