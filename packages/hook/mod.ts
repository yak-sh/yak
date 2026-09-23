/**
 * An event another system delivered. The payload is kept as it arrived —
 * body, method, path, headers — beside the result of checking its signature,
 * because an unsigned hook is still something that happened, and whoever reads
 * it decides what to trust.
 *
 * The components, and `hooked()`: a captured request in, the bundles that
 * record it out.
 */

export { hookDoc } from './vocab.ts'
export { event, hooked, hookEid, type Request } from './hooked.ts'
