/**
 * @yaks/egress — calls going out with a credential the caller never holds.
 *
 * An app is handed sentinels for the connections it uses
 * ({@link https://jsr.io/@yaks/connections | @yaks/connections}), and puts one
 * wherever the service wants its key or token. {@link forward} sends the
 * request on with the credential in the sentinel's place, once the caller may
 * call out through that connection
 * ({@link https://jsr.io/@yaks/member | @yaks/member} `callsOut`) and the
 * request goes to a host its integration names. A service that refuses an
 * access token is asked once more with a refreshed one. Each call is counted
 * on the app's `uses` link by the month ({@link counting}), and a link with a
 * `cap` refuses calls past it ({@link Capped}).
 *
 * ```ts
 * import { forward } from '@yaks/egress'
 *
 * // the host vouches for the caller, and the egress does the rest
 * // let res = await forward({ graph: g, vault, defer }, { app, level: 'viewer', person }, req)
 * ```
 *
 * @module
 */

export {
  type Caller,
  Capped,
  forward,
  type Grant,
  granted,
  grants,
  type Host,
  Refused,
  sentinelsIn,
} from './egress.ts'
export {
  CALLED,
  calling,
  CALLS,
  capOf,
  counted,
  counting,
  monthOf,
  spent,
} from './calls.ts'
export { egressDoc } from './vocab.ts'
