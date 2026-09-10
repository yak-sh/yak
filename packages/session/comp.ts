import { contextDoc } from '@yaks/context'
// The vocabulary this package ships, as one document to load beside your own
// (./vocab.json — plain JSON Schema). A session is a TRANSCRIPT: nothing is
// launched as a host process — entries appear, and a daemon reacts to the
// newest one. The comps are the session's identity, its lock, and the kinds of
// entry; the words a run's PROCESS needs (pid, pane, a log to tail) belong to
// the application that runs processes, never here.
//
//   session{id, status}      identity only; `status` is computed, never stored
//   spawned{parent, call}    delegated by a parent, from a tool call
//   fork{from}               continues another transcript from one entry
//   claim{session}           the session's lock on the entity it rides
//   conflict{target, loser, holder, at}
//                            two sessions wanted one thing (stamped: audit)
//   entry{session, seq}      one line; the comp beside it says what kind
//     + content{body, source}
//                            its prose, when it has any. Alone, an INPUT: an
//                            instruction (the first one is the request). With
//                            a source, an OUTPUT: what a model said, from that
//                            ask. Beside a result, error or exception, theirs
//     + using{provider, model, effort, instructions}
//                            set or switch on an input; served on an ask
//     + ask{to, through}     the model was asked, from the prefix at `through`
//     + call{to, id, args, source}
//                            a tool the model asked for, from that ask
//     + result{call}         what a tool answered
//     + stop                 the daemon performs nothing after this
//     + error{code}          expected and recorded: normal
//     + exception            unexpected: a defect report, not a stop
//
// An ask and a call share no columns on purpose: one is the daemon reaching a
// model, the other the model reaching a tool. What a provider keeps about an
// ask — OpenAI's response id, say — is that provider's own comp on the same
// entry (`@yaks/openai` declares `openai{response_id}`), never a column here.
// There is no `input` or `output` comp either: both are inferred from
// `content` — one direction has a source, the other has none — so the invalid
// state "input and output at once" cannot be written.
//
// What a `using` names — `provider`, `model` — and what a `call.to` reaches —
// a `tool` — are @yaks/model's entities, loaded beside this document.
//
// The shape worth noticing is the CLAIM. A lock is not a row about a document
// somewhere else — it is a component ON the document, so "who holds this?" is
// answered by the entity itself, one lock per entity by construction, and a
// query for locked documents is a query for entities wearing `claim`.
// `claim.session` dies by `release`: when a session's entity is deleted its
// lock ROW goes and the document it was on lives — declared here, executed by
// @yaks/graph's cascade, with no code in this package at all. `conflict` is
// entirely stamped: the audit is written by the graph after a refusal, never
// sent by a client.

import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }

/** The session vocabulary, to load beside your own and beside @yaks/model's:
 * `loadVocab([sessionDoc, modelDoc, ...mine])`. */
export let sessionDoc: VocabDoc = { ...doc, $defs: { ...doc.$defs, ...contextDoc.$defs } }

export let SESSION = 'session'
export let CLAIM = 'claim'
export let CONFLICT = 'conflict'
