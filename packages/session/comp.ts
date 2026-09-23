// The vocabulary this package ships, as one document to load beside your own
// (./vocab.json — plain JSON Schema). A session is a transcript: no process is
// launched — entries appear, and a daemon reacts to the newest one. The
// components are the session's identity, its lock, and the kinds of entry; the
// components a run's process needs (pid, pane, a log to tail) belong to the
// application that runs processes, never here.
//
//   session{id, status}      identity only; `status` is computed, never stored
//   spawned{parent, call}    delegated by a parent, from a tool call
//   fork{from}               continues another transcript from one entry
//   claim{session}           the session's lock on the entity it rides
//   conflict{target, loser, holder, at}
//                            two sessions wanted one thing (stamped: audit)
//   entry{session, seq}      one line; the component beside it is its kind
//     + content{body}        its prose, when it has any. Alone, an input: an
//                            instruction (the first one is the request).
//                            Beside a result, error or exception, theirs
//     + output{source}       what produced the prose beside it: the ask, for
//                            what a model said
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
// An ask and a call share no properties on purpose: one is the daemon reaching
// a model, the other the model reaching a tool. What a provider keeps about an
// ask — OpenAI's response id, for instance — is that provider's own component
// on the same entry (`@yaks/openai` declares `openai{response_id}`), never a
// property here. There is no `input` component: prose with no `output` beside
// it is one, so the invalid state "input and output at once" cannot be written.
//
// Half the entry components above are declared by other packages, and this
// document declares only its own: `content`, `output`, `call`, `result`,
// `error` and `exception` are @yaks/tools's — a call is the record of having
// asked a tool, whoever asked it — and an instruction assembled from parts is
// @yaks/context's `prompt`. What a `using` names — `provider`, `model` — is
// @yaks/model's, and what a `call.to` names is @yaks/tools's `tool`. An
// application whose provider returns images wants @yaks/blob too, since that is
// what ./react.ts writes a reply's artifacts as. An application that wants a
// transcript composes those packages beside this one; that is what a plugin
// list is for, and one component declared in two documents is a vocabulary
// `loadVocab` refuses to load.
//
// The shape worth noticing is the CLAIM. A lock is not a row about a document
// somewhere else — it is a component on the document, so "who holds this?" is
// answered by the entity itself, one lock per entity by construction, and a
// query for locked documents is a query for entities that have a `claim`.
// `claim.session` is declared `death: 'release'`: when a session's entity is
// deleted its lock row goes and the document it was on survives — declared
// here, carried out by @yaks/graph's cascade, with no code in this package at
// all. Every `conflict` property is server-owned: the audit row is written by
// the graph after a refusal, never sent by a client.

import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }

/** The session vocabulary, to load beside the packages whose components a
 * transcript uses — what serves an ask (@yaks/model), what a call and its
 * result are (@yaks/tools), what an instruction is made of (@yaks/context):
 * `loadVocab([sessionDoc, modelDoc, toolsDoc, contextDoc, ...mine])`. */
export let sessionDoc: VocabDoc = doc

export let SESSION = 'session'
export let CLAIM = 'claim'
export let CONFLICT = 'conflict'
