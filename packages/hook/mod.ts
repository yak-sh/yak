/**
 * An event another system delivered. The payload is kept as it arrived —
 * body, method, path, headers — beside the result of checking its signature,
 * because an unsigned hook is still something that happened, and whoever reads
 * it decides what to trust.
 *
 * The components; `hooked()`: a captured request in, the bundles that record
 * it out; and `checked()`/`refusal()`: whether a request is signed under a
 * scheme and secret the receiver names.
 */

export { hookDoc } from './vocab.ts'
export { event, hooked, hookEid, type Request } from './hooked.ts'
export {
  checked,
  type HeaderLookup,
  type Hmac,
  refusal,
  type Scheme,
  SKEW,
} from './signed.ts'
