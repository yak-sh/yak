/**
 * A builder's `doc` body is its instruction; its `builder.query` selects its
 * inputs. One run opens a session, whose JSON answer writes named output
 * entities. Each wears `built{builder, variant, slot, key, model, session}`
 * and cites the particular inputs it used.
 *
 * The key is a hash of the instruction, the model and each input's content
 * hash. An unchanged key opens no session; a changed key updates each named
 * output in place. Explicit alternate model or prompt builds get sibling
 * shadow outputs, which downstream builders do not read.
 *
 * A build is one agent session, asked the instruction and the inputs by id,
 * whose answer is an array of graph-shaped outputs. It opens on a schedule
 * (`floor`, a configured `rest`, and @yaks/wake), as inputs change when
 * `builder.immediate` is true, or on demand through the `builder build` tool.
 *
 * ```ts
 * import { effects } from '@yaks/effects'
 * import { watches } from '@yaks/builders/effects'
 *
 * // let fx = effects(vocab, { write: (b) => g.apply(b, { trusted: true }) })
 * // fx.handle(watches({ desk: { model: 'O-1' }, vocab }))
 * ```
 *
 * @module
 */

export { builderDoc } from './vocab.ts'
export * from './key.ts'
export * from './build.ts'
