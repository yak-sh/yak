// Waiting component patches: keep only their newest value, but retain a
// clear before a later partial patch so an older property cannot return.

export { coalesced, coalescer } from './bundle.ts'
