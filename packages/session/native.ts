// The names of the transcript comps (./comp.ts keeps the prose and the
// document). Every kind of entry is a comp the entry wears beside `entry`,
// except the two directions of prose: `content` alone is an input, `content`
// with a `source` is what a model said. `kindOf` (./status.ts) reads the label
// off whichever is present.

export let FORK = 'fork'
export let ENTRY = 'entry'
export let CONTENT = 'content'
export let USING = 'using'
export let ASK = 'ask'
export let CALL = 'call'
export let RESULT = 'result'
export let STOP_ENTRY = 'stop'
export let ERROR = 'error'
export let EXCEPTION = 'exception'
