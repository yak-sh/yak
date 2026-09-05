// The five components this package ships, as one vocabulary document to load
// beside your own.
//
//   session{id, actor, parent, provider, model, effort, turn, …}
//                            one run of a worker over the graph
//   claim{session}           that run's lock on the entity it rides
//   stop_request{target}     ask a run to wind down
//   brief{text}              what the run says it did
//   conflict{target, loser, holder, at}
//                            the record of two runs wanting one thing
//
// The shape worth noticing is the CLAIM. A lock is not a row about a document
// somewhere else — it is a component ON the document, so "who holds this?" is
// answered by the entity itself, one lock per entity by construction, and a
// query for locked documents is a query for entities wearing `claim`.
//
// `claim.session` dies by `release`: when a run's entity is deleted its lock
// ROW goes and the document it was on lives. That is the whole "a dying run
// lets go" rule — declared in the vocabulary, executed by @yaks/graph's
// cascade, with no code in this package at all.
//
// `conflict` is entirely stamped: every column is server-owned, because the
// audit is written by the graph after a refusal, never sent by a client. A
// forged conflict record would be worse than none.
//
// The document itself is `./vocab.json` — plain JSON Schema, readable by
// anything that reads JSON. This file re-exports it under the name callers
// say and keeps the prose about why it is shaped the way it is.

import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }

/** The component naming one run of a worker over the graph. */
export let SESSION = 'session'

/** The component naming a run's lock on the entity that carries it. */
export let CLAIM = 'claim'

/** The component asking a run to wind down. */
export let STOP = 'stop_request'

/** The component carrying what a run says it did. */
export let BRIEF = 'brief'

/** The component recording a refused take of somebody else's lock. */
export let CONFLICT = 'conflict'

/**
 * The session vocabulary, to load beside your own:
 * `loadVocab([sessionDoc, ...mine])`. It declares nothing about what the work
 * IS — a document, a task, a drawing are all plain entities in your own
 * vocabulary — only who is working, what they hold, and what happened when two
 * of them wanted the same thing.
 */
export let sessionDoc: VocabDoc = doc
