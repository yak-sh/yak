/**
 * @yaks/connections — the outside services a yaks graph can reach, and the
 * links between a space or a person and one.
 *
 * An **integration** is an outside service as data: where a person signs in to
 * it and where its codes are exchanged, for one reached by OAuth, and the hosts
 * its credential may be sent to. The built ones ship with this package
 * ({@link BUILT}); a custom one is an `integration` entity in the space.
 *
 * A **connection** is one link through an integration, owned by a space or a
 * person, and is also the secret its credential is kept as
 * ({@link https://jsr.io/@yaks/secrets | @yaks/secrets}): the graph holds a
 * handle, the vault holds the key or the tokens, and code that calls out is
 * handed a sentinel. A `uses` link says which app calls out through which
 * connection.
 *
 * ```ts
 * import { need, connect, resolve } from '@yaks/connections'
 *
 * // an app says what it needs; the space sees it as needed
 * // await g.apply(await need(g.read, { owner: space, app, integration: 'twilio' }))
 * // the person pastes the key; it goes to the vault
 * // await connect({ graph: g, vault }, connection, { key })
 * // the app is handed what it calls out with
 * // await resolve({ graph: g, vault }, app, 'twilio') → { connection, link, sentinel }
 * ```
 *
 * An app may instead ask each person who uses it to connect their own
 * (`each`): each person's connection is theirs, and only they call out
 * through it.
 *
 * The verbs: {@link need}, {@link list} (the two tools), {@link using},
 * {@link begin} and {@link connect}, {@link disconnect}, {@link resolve},
 * {@link used} and {@link envOf}, {@link credential}, {@link refresh}. A host
 * that composes this package
 * composes @yaks/secrets, over its vault, and @yaks/edge beside it; the egress
 * that swaps sentinels is @yaks/egress.
 *
 * @module
 */

export { connectionsDoc } from './vocab.ts'
export {
  BUILT,
  connectable,
  INTEGRATION,
  type Integration,
  integrationEid,
  keyed,
  known,
  type Read,
} from './integrations.ts'
export {
  begin,
  bindingOf,
  connect,
  CONNECTION,
  credential,
  type Ctx,
  disconnect,
  envOf,
  type Given,
  list,
  type Need,
  need,
  refresh,
  resolve,
  type Resolved,
  type Status,
  used,
  USES,
  using,
} from './connections.ts'
