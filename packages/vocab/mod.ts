// @yaks/vocab — the vocabulary meta-model: a way to DESCRIBE a component
// vocabulary as JSON Schema (2020-12) plus a small custom keyword vocabulary,
// and the runtime that loads and interrogates any such description.
//
// It ships ZERO components. The fleet's ~90 comps are an instance it loads; a
// customer app is a smaller instance in the same format — one format for both,
// an app just composes fewer vocabularies.
//
// The pieces:
//   meta.ts      the keyword vocabulary ($vocabulary docs, core + fleet layers)
//                and the meta-schema a vocab file validates against
//   vocab.ts     loadVocab(docs) → Vocab: the interrogation + routing API a
//                binder (@yaks/sql) consumes — column types, path routing,
//                kindOrder/kindOf, death worklists, instance checks
//   validate.ts  document validation: the storable profile, reserved names,
//                additive-forever evolution
//   order.ts     the derived ordering (alphabetical + topological over `before`)

export * from './types.ts'
export * from './order.ts'
export * from './vocab.ts'
export * from './validate.ts'
export * from './meta.ts'
