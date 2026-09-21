// The names of the transcript components (./comp.ts holds the prose and the
// document). Every kind of entry is a component stored beside `entry`: prose is
// `content{body}`, and an `output{source}` beside it records what produced it.
// `kindOf` (./status.ts) reads the kind off whichever is present.

export let FORK = 'fork'
export let ENTRY = 'entry'
export let CONTENT = 'content'
export let OUTPUT = 'output'
export let USING = 'using'
export let ASK = 'ask'
export let CALL = 'call'
export let RESULT = 'result'
export let STOP_ENTRY = 'stop'
export let ERROR = 'error'
export let EXCEPTION = 'exception'
