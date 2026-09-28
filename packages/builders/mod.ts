/**
 * A builder's `doc` body is its instruction; its `builder.query` selects its
 * inputs. Its stable output wears `built{builder, slot, key, model, session}`
 * and cites the inputs used for the latest build.
 *
 * The key is a hash of the instruction, the model and each input's content
 * hash. An unchanged key opens no session; a changed key updates the output
 * in place. Explicit alternate model or prompt builds get sibling shadow
 * outputs, which downstream builders do not read.
 *
 * A build is one agent session, asked the instruction and the inputs by id,
 * whose answer becomes the output's body. It opens on a schedule (`floor`, a
 * configured `rest`, and @yaks/wake) through `@yaks/builders/effects`, or on
 * demand through the `builder build` tool in `@yaks/builders/tools`.
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
