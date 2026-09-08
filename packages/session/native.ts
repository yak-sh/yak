// The native half of the package: a session as a TRANSCRIPT. Nothing is
// spawned, started or stopped — entries appear, and a daemon reacts to the
// newest one. The comps here are the kinds of entry and the two facets a native
// session wears (`transcript`, `fork`); the words a run's PROCESS needs (pid,
// pane, a log to tail) stay in ./vocab.json for the CLI providers and never
// appear on a native session.
//
//   transcript{status}       the native session's mark; status is computed
//   fork{from}               continues another transcript from one entry
//   entry{session, seq, text}
//     + input                an instruction (the first one is the request)
//     + using{provider, model, effort}
//                            set or switch on an input; served on a call
//     + call{to, through, response_id | id, args, source}
//                            a model call, or a tool call the model asked for
//     + output{source}       what a model said
//     + result{call}         what a tool answered
//     + stop                 the daemon performs nothing after this
//     + error{code}          expected and recorded: normal
//     + exception            unexpected: a defect report, not a stop
//
// What a `using` names — `provider`, `model` — and what a `call.to` may reach —
// a `tool` — are @yaks/model's entities, loaded beside this document.
//
// The document is ./native.json — plain JSON Schema. This file names the comps
// for callers and keeps the prose.

import type { VocabDoc } from '@yaks/vocab'
import doc from './native.json' with { type: 'json' }

/** The native session vocabulary, to load beside {@link sessionDoc} and
 * @yaks/model's `modelDoc`. */
export let nativeDoc: VocabDoc = doc

export let TRANSCRIPT = 'transcript'
export let FORK = 'fork'
export let ENTRY = 'entry'
export let INPUT = 'input'
export let USING = 'using'
export let CALL = 'call'
export let OUTPUT = 'output'
export let RESULT = 'result'
export let STOP_ENTRY = 'stop'
export let ERROR = 'error'
export let EXCEPTION = 'exception'
