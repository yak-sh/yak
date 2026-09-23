/**
 * A builder is an instruction plus its inputs, and it builds one output. The
 * instruction is the builder's `doc` body; its inputs are the entities its
 * @yaks/kernel `reads` links point at; its output is an entity wearing
 * `built{builder, key, model, session}`.
 *
 * The key is a hash of the instruction, the model and each input's content
 * hash, and the output's id is derived from the builder and the key. So an
 * unchanged key names the output already built, which is reused and nothing
 * runs; a changed key names a new one, built from scratch. A builder never
 * reads its own output, and two models on one builder build sibling outputs.
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
 * // for (let { comp, ...w } of watches({ desk: { model: 'O-1' }, vocab }))
 * //   fx.on(comp, w)
 * ```
 *
 * @module
 */

export { builderDoc } from './vocab.ts'
export * from './key.ts'
export * from './build.ts'
