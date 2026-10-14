// A code tool whose answer is a pure function of what its call asks: the
// frozen binding, template, using and wiring, and nothing it reads or writes
// elsewhere. Builders answers one in place, in the transaction that plans the
// build, so an attempt costs its build, its call and its outputs: no runner
// claim, no result or output record, no answer effect, and no second copy of
// the binding or the answer. Registered with a runner as well, the same tool
// answers a call written by a process that does not hold it, with the same
// outputs (./answer.ts is the one contract).

import type { Binding, Bundle, Comp, ReadTx, Tool } from '@yaks/graph'
import { argsOf } from '@yaks/graph/call'
import { Refused } from '@yaks/graph/errors'
import { after } from '@yaks/fp'
import type { Vocab } from '@yaks/vocab'
import { outputs, spent, type Wiring } from './answer.ts'
import { step, steps } from './steps.ts'

/** What a builder's call asks its tool. */
export type Args = {
  binding: Binding
  key: string
  inputs: string
  definition: string
  template: string
  using: Comp
  wiring?: Wiring
}

// What a builder's call carries, as a runner checks it.
let ASKED = {
  type: 'object',
  properties: {
    binding: { type: 'object' },
    key: { type: 'string' },
    inputs: { type: 'string' },
    definition: { type: 'string' },
    template: { type: 'string' },
    using: { type: 'object' },
    wiring: { type: 'object' },
  },
  required: ['binding', 'key'],
}

/** An answer: `{outputs, cost?}`, as ./answer.ts reads it. */
export type Answer = (args: Args) => unknown

/** A code tool builders can answer in place. */
export type Code = Tool & { answer: Answer }

/** A code tool from its answer. Its `run` is the same answer recorded as a
 * call's output, for a runner asked to run one.
 *
 * ```ts
 * import { code } from '@yaks/builders'
 *
 * let twice = code({
 *   name: 'twice',
 *   description: 'Double the number a binding names',
 *   revision: '1',
 *   answer: ({ binding }) => ({
 *     outputs: [{
 *       slot: 'main',
 *       inputs: [binding.entities[0]],
 *       components: { doc: { body: String(Number(binding.vars.n) * 2) } },
 *     }],
 *   }),
 * })
 * twice.name // 'twice'
 * ```
 */
export let code = (tool: Omit<Tool, 'run'> & { answer: Answer }): Code => ({
  inputSchema: ASKED,
  ...tool,
  run: (call) =>
    after(tool.answer(argsOf(call) as Args), (value) => [{
      entity: { eid: crypto.randomUUID() },
      output: { source: call.entity.eid, value },
    }]),
})

/** One attempt answered in place, from the bundles that start it (build.ts
 * `start`): the build, its call, its key, and the outputs the answer makes.
 * The call keeps every argument but the binding, which is the build's own
 * inputs, and is written taken (`execution`), so no runner runs it again. An answer that throws or breaks the contract is the build's
 * `failed{reason}`, kept under its attempt key like a refused answer, so no
 * door asks again until its inputs change; `report` hears all but a
 * refusal. */
export let answered = (
  tx: ReadTx,
  [run, asked, key]: Bundle[],
  tool: Code,
  vocab: Vocab,
  report?: (err: unknown) => void,
): Bundle[] | Promise<Bundle[]> =>
  steps(function* () {
    let { binding: _, ...rest } = (asked.call as Comp).args as Args
    let call: Bundle = {
      ...asked,
      call: { ...asked.call as Comp, args: rest },
      execution: {},
    }
    try {
      let value = yield* step(tool.answer((asked.call as Comp).args as Args))
      let made = yield* step(outputs(tx, run, asked, value, vocab))
      return [run, { ...call, ...spent(call, value)[0] }, key, ...made]
    } catch (err) {
      if (!(err instanceof Refused)) report?.(err)
      let reason = err instanceof Error ? err.message : String(err)
      return [{ ...run, failed: { reason } }, call, key]
    }
  })
