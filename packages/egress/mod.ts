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
 * access token is asked once more with a refreshed one.
 *
 * ```ts
 * import { forward } from '@yaks/egress'
 *
 * // the host vouches for the caller, and the egress does the rest
 * // let res = await forward({ graph: g, vault }, { app, level: 'viewer', person }, req)
 * ```
 *
 * @module
 */

export { type Caller, forward, Refused } from './egress.ts'
