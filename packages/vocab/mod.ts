// @yaks/vocab — the vocabulary format: a way to describe a set of components
// as a JSON Schema (2020-12) document plus a small set of custom keywords, and
// the runtime that loads such a document and answers questions about it.
//
// It declares zero components. The components you declare are an instance of
// the format; a small app is a smaller instance in the same format — an app
// just composes fewer documents.
//
// The pieces:
//   meta.ts      the core keyword set (a JSON Schema $vocabulary document) and
//                the meta-schema a vocabulary document validates against
//   keywords.ts  the extension point: another package registers its own
//                keywords, and the loader carries them without interpreting
//                them
//   vocab.ts     loadVocab(docs) → Vocab: the query and routing API a storage
//                binder (@yaks/sql) calls — property types, path routing,
//                kindOrder/kindOf, delete worklists, instance checks
//   validate.ts  document validation: the storable profile, reserved names,
//                additive-forever evolution
//   order.ts     the derived ordering (alphabetical + topological over `before`)
//   lifetime.ts  the two things a component declares about its own state:
//                `sync` (who is told about a write) and `durable` (how long a
//                value lives)
//   rules.ts     rulesIn(docs) → the rules a vocabulary declares: a `$defs`
//                entry marked `rule: true` is a query the graph runs, and
//                there is no implementation to join it to
//   effects.ts   effectsIn(docs) → the effects a vocabulary declares: a
//                `$defs` entry marked `effect: true` names what a commit owes,
//                and a plugin's code runs it by that name

export * from './types.ts'
export * from './order.ts'
export * from './lifetime.ts'
export * from './vocab.ts'
export * from './validate.ts'
export * from './meta.ts'
export * from './keywords.ts'
export * from './rules.ts'
export * from './effects.ts'
