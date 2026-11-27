// The paths a store's move answers at (relocate.ts), apart from the move
// itself, so a caller that only names one (visit-birth.ts, sweep.ts) loads
// none of @yaks/durable-object with it.
export let LEAVE = '/relocate'
export let ARRIVE = '/relocate/arrive'
export let WHERE = '/relocate/where'
export let COPY = '/relocate/copy'
