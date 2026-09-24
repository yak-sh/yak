# @yaks/connections

The outside services a yaks graph can reach, and the links between a space or a
person and one. An **integration** is an outside service as data; a
**connection** is one link through an integration, owned by a space or a person,
holding the credential it uses. No key or token is ever graph data: a connection
is also a [@yaks/secrets](../secrets) secret, so the graph holds a handle, the
vault holds the credential, and code that calls out is handed a sentinel.

It builds no HTTP route, page or egress. A host draws the page where a person
connects, runs the OAuth callback, and swaps sentinels on the way out with these
verbs.

## Stored data

- `integration{name, authorize, token, scopes, params, auth, hosts, signature}`
  is a custom integration, kept in the space. `name` is its identity, so one
  name is one integration. An integration with `authorize` and `token` is
  connected by signing in (OAuth 2 with PKCE, through [@yaks/oauth](../oauth));
  one without is a pasted key. `hosts` are the only API hosts its credential may
  be sent to, and `signature` is the [@yaks/hook](../hook) scheme its webhooks
  are signed with.
- `connection{integration, owner, account, scopes, status}` names its
  integration, the space or person that `owner`s it (and is deleted with them),
  the outside account, the scopes asked for or granted, and `status`: `needed`
  (no credential yet), `connected`, or `broken` (the service refused it). The
  same entity wears `secret{name, value}`: its name is `connection:` and a
  random id, and the entity id is derived from it. Its value is the handle of a
  pasted key, or of the OAuth tokens kept as a JSON record.
- `uses` is the relation on an [@yaks/edge](../edge) link from an app to the
  connection it calls out through.

The built integrations ship with this package as data, one JSON file each, in
`BUILT` by name. A built name is never a custom one's: `need` will not make one,
and a lookup finds the built one first, so a space cannot change where a built
integration's tokens are sent.

## Verbs

The two an untrusted caller may ask are the tools. Each returns bundles for the
caller to apply in its own name:

- `need(read, {owner, integration, app?, scopes?, hosts?}, built?)` makes a
  `needed` connection and the `uses` link from the app. For a service with no
  integration, `hosts` makes a custom key integration, and hosts that differ
  from an existing one's are refused. An app that already uses a connection
  through that integration is answered with it. `need` never links an app to a
  connection that holds a credential: giving an app a person's account is the
  person's act.
- `list(read, owner)` returns the owner's connections and the `uses` links to
  them.

The rest are for trusted code, and act on the `Ctx` they are given (the graph,
its vault, the built integrations, the OAuth client registered with each, and
the redirect):

- `begin(ctx, connection)` returns the sign-in link and the attempt to keep
  until the person returns.
- `connect(ctx, connection, given, account?)` keeps a pasted key (`{key}`), or
  completes a sign-in (`{attempt, callback}`), and marks the connection
  `connected`. A key goes from here straight to the vault.
- `disconnect(ctx, connection)` deletes the connection, which drops its
  credential from the vault. Each app that used it is linked to a new `needed`
  connection in the same change.
- `resolve(ctx, app, integration)` returns the connected connection an app uses
  and the sentinel for its credential, or nothing. Whether the caller may use it
  is the egress's check.
- `refresh(ctx, connection, stale)` gets a new access token behind the same
  handle once the service has refused `stale`. A grant the service refuses marks
  the connection `broken`. A failure on the wire does not.

## Hosting it

`@yaks/connections/vocab` declares the components and the tools
`connection_need` and `connection_list`; `@yaks/connections/tools` implements
the tools. A host that composes this package also composes @yaks/secrets over
its vault, which seals each credential as the write commits and drops it when
the connection is deleted, and @yaks/edge, which derives each `uses` link's id.
