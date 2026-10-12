// The `$` keys a batch may carry. A bundle's ordinary keys name components,
// and admission refuses one this graph does not declare. A `$` key is another
// kind of thing: it asks the pipeline to DO something, and a request nobody
// implements did not happen — `$num: true` on a graph with no allocator would
// return a bundle with no number and no word about why. So an unknown request
// is refused too, and a plugin says which ones it answers (`Plugin.requests`).
//
// `$alias` and `$quiet` are the core's own bookkeeping rather than a caller's
// ask, and they are admitted for the same reason a stamped property is: a
// caller that read a bundle back and sent it again is doing a normal thing.

export { requested, REQUESTS } from './bundle.ts'
