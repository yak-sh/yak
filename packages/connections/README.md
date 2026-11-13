# @yaks/connections

The outside services a yaks graph can reach, and the links between a space or a
person and one. An **integration** is an outside service as data; a
**connection** is one link through an integration, owned by a space or a person,
holding the credential it uses. No key or token is ever graph data: a connection
is also a [@yaks/secrets](../secrets) secret, so the graph holds a handle, the
vault holds the credential, and code that calls out is handed a sentinel.

Its `./views` facet draws connections as integration title, account and status,
and names the apps whose `uses` links the host holds. An unknown integration
title falls back to its name. Neither the secret's key nor its value is drawn.
The CLI composes these views for commands such as `yak connection list Alex`;
browser hosts use the same views for tiles and connection pages.

A host draws the page where a person connects and runs the OAuth callback with
these verbs, and [@yaks/egress](../egress) swaps sentinels on the way out with
them.

## Stored data

- `integration{name, title, tagline, site, logo, authorize, token, scopes,
  params, auth, refresh_encoding, client, client_id, broker, hosts, signature,
  testing, built, instructions, owner}`
  is an outside service. `name` is its identity, so one name is one integration.
  `title`, `tagline`, `site` and `logo` are how a page shows it: what a person
  calls it, one line saying what it is, its address on the web, and its mark as
  an SVG document, which a page draws as an image and never as markup. An
  integration with `authorize` and `token` is connected by signing in (OAuth 2
  with PKCE, through [@yaks/oauth](../oauth)); one without is a pasted key.
  `fields` are what a person gives to connect one that takes more than a key,
  each `{name, label, shown}`: S3's access key ID, secret key and region. The
  connections page asks for each by its label, masked unless `shown`. None is
  one key, the field `key`; fields are said when the integration is made and
  never change. `broker{name, integration}` says new connections through it are
  made through a broker (see Brokers below) and what the broker calls it; none
  is direct. `hosts` are the only API hosts its credential may be sent to, and
  `signature` is the [@yaks/hook](../hook) scheme its webhooks are signed with.
  `built` is server-owned: it marks one this package builds, or one the host
  wrote from a broker's catalog (see The catalog below). `instructions` is
  markdown saying how a person gets the credential (where to sign up, which page
  issues the key, what to paste), written for them and for the agent helping
  them; a host shows it wherever the integration is met. `owner` is the space or
  person that made a custom integration, and the only one who may change its
  `title`, `tagline`, `site` or `instructions`. Its `hosts` may wait until it is
  used: a key kept with none is sent nowhere, and its owner names them once,
  after which nobody changes them. A built integration has no owner, and one
  whose owner is gone is nobody's to change.
- A custom integration its owner listed in the **integration directory**, which
  anyone may read and add to a space of their own apart from any app, wears
  @yaks/platform's `published{at}`, as anything shared on a platform does;
  taking it off takes it out. Every built integration is in the directory
  without it.
- `connection{integration, owner, account, scopes, status, broker}` names its
  integration, the space or person that `owner`s it (and is deleted with them),
  the outside account, the scopes asked for or granted, and `status`: `needed`
  (no credential yet), `connected`, or `broken` (the service refused it). The
  same entity wears `secret{name, value}`: its name is `connection:` and a
  random id, and the entity id is derived from it. Its value is the handle of a
  pasted key, of its several fields kept as a JSON object by name, or of the
  OAuth tokens kept as a JSON record. `broker` names the broker it was made
  through; its record then holds the broker's id for it, what the broker calls
  its integration, and the current access token.
- `uses{anyone, each, binding, direct, cap}` is the relation on an
  [@yaks/edge](../edge) link from an app to the connection it calls out through.
  Only a caller holding a level on the app may call out through it, unless
  `anyone` opens it to everyone, signed in or not, as a public widget's key is.
  Opening it, like giving an app a connection, is the person's act. `each` says
  the app asks each person who uses it to connect their own: it marks the app's
  ask, a needed connection its space holds, and the link to every person's own
  connection through that integration, and a link marked so is spent only by the
  person who owns its connection. `binding` is the name the app's code reads it
  by (`env.NAME` in a worker; for several fields, one name each,
  `env.NAME_FIELD`, as `namesOf` says), and `direct` hands that code the key
  itself rather than a sentinel, for a key it must sign with; only a pasted key
  shared by everyone may be direct. `cap` is the most calls a month that may go
  out through the link, which [@yaks/egress](../egress) counts on it as
  `calls{month, count}` and refuses past; none is no limit. Only the host sets
  it, never the app it caps.

Every integration is an entity in the graph. The ones this package builds ship
as seed data, one JSON file each, which a host installs into its graph at
start-up, trusted (`install`); nothing reads the files after that. A custom one
is made by `need`, only where no integration holds the name yet, so no verb a
space can reach writes over a built integration or changes where its tokens are
sent, and only the host can mark one `built`. Each logo is the service's mark
from [Simple Icons](https://simpleicons.org) (CC0, simple-icons 16.32.0), in its
brand colour. `anthropic` is built: a pasted API key, sent to
`api.anthropic.com` alone, with no logo yet. `voipms` is built: a person's own
phone number at voip.ms, its fields the account's sign-in email (`username`) and
API password (`password`), sent to `voip.ms` alone, with no logo yet. A voip.ms
key kept before it named fields, the two joined by a colon, is read as them the
first time it is used and kept as them. `openrouter` is built: its sign-in needs
no registered client, and its exchange answers an API key (`answers: 'key'`,
@yaks/oauth), kept as the connection's grant. `google-calendar` is built: it
asks for `calendar.events` and `calendar.calendarlist.readonly` unless an app
needs narrower, asks Google for offline access so the grant can be refreshed,
and sends its token to `www.googleapis.com` alone. It is `testing: true` while
Google's app is in testing mode, where only the people Google lists may sign in,
so yaks.app offers it only on a connections page opened with
`?enable=google-calendar`. `gmail` is brokered by Nango's CASA-verified Google
app (`broker: {name: 'nango', integration: 'google-mail'}`, D-151626), whose
grant reads and sends mail, and it sends its token to `gmail.googleapis.com`
alone. A gmail connection made earlier, directly as the `google` client asking
for `gmail.send`, keeps signing in that way. `openai` is built for the native
harness's ChatGPT sign-in; it uses a public OAuth client, asks for a refreshable
grant, and sends its bearer to `chatgpt.com`.

An integration reached by OAuth signs in as the client it names
(`client: 'google'`), registered once with the service and shared by every
integration that names it: google-calendar and gmail name `google`, as a later
google-drive would. The client is a secret, kept as `oauth_client <name>`:
`registration(name, {id, secret})` is the bundle that seals it, so the graph
holds its handle and the vault its id and secret, and `clientOf` reads it back
at sign-in. A custom integration never signs in as a client a built one names,
whose secret would go to the custom one's token endpoint. `connectable` says
whether an integration can be connected there at all, and the page offers only
those. A built integration with a public OAuth client carries its `client_id`
directly as data; there is no secret to register or reveal.

## Verbs

The two an untrusted caller may ask are the tools. Each returns bundles for the
caller to apply in its own name:

- `need(read, {owner, integration, app?, scopes?, hosts?, fields?, each?,
  binding?, direct?, title?, tagline?, site?, instructions?})`
  makes a `needed` connection and the `uses` link from the app, read by
  `binding` (default: the integration's name in capitals, `bindingOf`). For a
  service with no integration, it makes a custom key integration sent to the
  `hosts` given, asking for the `fields` given, owned by `owner` and saying what
  `title`, `tagline`, `site` and `instructions` give; any of those four given
  for an integration that stands is `set` by its owner, and refused for anyone
  else. Hosts may wait: one made with none (a key kept before anyone uses it, or
  a `direct` key, handed to the app's code) is sent nowhere until its owner asks
  with them, and hosts that differ from ones already named are refused. An app
  that already uses a connection through that integration is answered with it,
  and with its link renamed where `binding` or `direct` was given. `need` never
  links an app to a connection that holds a credential: giving an app a person's
  account is the person's act. With `each`, the owner is the space asking each
  person, or a person making their own, and an app is answered with the one that
  owner holds. The connection comes first in what it returns.
- `list(read, owner)` returns the owner's connections, the `uses` links to them,
  and the integrations they go through.

`attach(read, {owner, app, connection, binding?})` plans an owner's grant of an
existing connected space connection to an app. The host checks that the actor
owns the space and that the app belongs to it; `attach` checks the connection's
owner and requested OAuth scopes. It replaces an unmet ask, retains that ask's
binding, removes the unused needed connection, and starts the new link
members-only with a sentinel. Attaching the connection an app already uses, with
a new `binding`, renames that binding. The key stays in the vault.

`set(read, {owner, integration, title?, tagline?, site?, instructions?, listed?})`
plans an owner's change to what is said about a custom integration: each
property given, trimmed, and an empty one cleared; `listed` publishes it in the
integration directory or takes it out, and publishing it again while it is
published keeps the moment it was first published. It refuses a built
integration, an owner other than the one the integration names, and a `site`
that is not an https address, and it never touches `hosts`. As with `attach`,
the host checks that the actor may act for that owner. `through(read, bundles)`
is the integrations the connections among `bundles` go through, but for those
already among them. `listing(read, words?)` is the integration directory: every
built integration but one in its service's testing mode, and every listed custom
one, by title, and with `words` only those whose name, title, tagline, site,
hosts or instructions hold every word.

`carry(read, {source, app, owner})` plans what a copy of an app asks for: a
`needed` connection owned by `owner`, the copy's space or person, for each
connection the `source` app uses and the copy does not yet, made by `need`
through the same integration, with the same `binding`, `direct`, `each` and
scopes. No credential travels, and neither does a link opened to anyone. A host
asks it when it installs a copy, and again when it updates one, which adds the
asks for what the new version gained and leaves the rest as the copy's person
made it.

`using(read, {app, integration, owner?, each?})` answers the connection an app
uses through an integration: the shared one, or with `each`, the one the owner
holds. A host reads the space's ask with it before a person connects their own.

`known(read, name)` is an integration by name, and `installed(read)` every built
one a graph holds. `install(read)` returns the bundles that install the built
integrations: each one missing, or held otherwise than its seed says, written
whole and marked `built`, and nothing where all match.

`pick(read, owner, integration, as?)` chooses an account. With no `as`, it
chooses the person's own email address, otherwise the oldest connection through
that integration. The default is computed, never stored. An explicit `as` is a
whole address or a local part that names just one account.

```ts
import { pick } from '@yaks/connections'
import { equal } from '@yaks/testing'
let accounts = [
  {
    entity: { eid: 'first' },
    connection: {
      integration: 'calendar',
      owner: 'ann',
      account: 'ann@example.com',
    },
  },
  {
    entity: { eid: 'second' },
    connection: {
      integration: 'calendar',
      owner: 'ann',
      account: 'work@example.com',
    },
  },
]
let read = (q: unknown) =>
  String(q).includes('.connection.owner=') ? accounts : []
equal((await pick(read, 'ann', 'calendar'))?.entity.eid, 'first')
equal((await pick(read, 'ann', 'calendar', 'work'))?.entity.eid, 'second')
```

The rest are for trusted code, and act on the `Ctx` they are given (the graph,
its vault, and the redirect):

- `begin(ctx, connection)` returns the sign-in link and the attempt to keep
  until the person returns.
- `connect(ctx, connection, given, account?)` keeps a pasted key (`{key}`),
  every field its integration names (`{fields}`), and no other, or completes a
  sign-in (`{attempt, callback}`), and marks the connection `connected`. A key
  goes from here straight to the vault. An OAuth sign-in names its account from
  the exchanged `id_token` email or `integration.userinfo`. Another account
  makes another connection; the same account renews behind its held handle.
- `disconnect(ctx, connection)` deletes the connection, which drops its
  credential from the vault. Each app that shared it is linked to a new `needed`
  connection in the same batch, by the same name, as directly and as openly; a
  person's own is not replaced, since the app still asks them.
- `resolve(ctx, app, integration, person?)` returns the connected connection an
  app uses through an integration for that person, its `uses` link and the
  sentinel for each field of its credential by name (`key` for one key or a
  sign-in), or nothing. `used(ctx, app, person?)` returns every one: the shared
  ones, and the person's own. Whether the caller may use a shared one is the
  egress's check.
- `envOf(ctx, app, person?)` is what the app's code is handed, by binding: the
  sentinel for each connected connection it uses, or the key itself where the
  link is direct, and for several fields each under its own name.
- `credential(ctx, connection, field?)` returns what a call out sends in a
  sentinel's place: the pasted key, the one `field` of several it names, or an
  access token, refreshed first when it is about to expire.
- `refresh(ctx, connection, stale)` gets a new access token behind the same
  handle once the service has refused `stale`. A grant the service refuses, here
  or in `credential`, marks the connection `broken`. A failure on the wire does
  not.
- `call(ctx, connection, request)` sends a request for the one who holds the
  connection, as their host's own code does for them (yaks.app's Operator), with
  the credential as its bearer: over https to a host its integration names and
  no other, following no redirect, and once more with a refreshed token when the
  service answers 401.

## Brokers

A broker signs a person in through its own app with a service, keeps the refresh
token, and hands back the current access token (./brokers.ts). It is a source of
credentials, never a proxy: the egress and `call` still send the token straight
to the integration's `hosts`, so who brokers an integration changes no caller.
Nango is the one implemented (`BROKERS`). Its key is the secret `broker nango`
(`brokerKey`), which yaks.app keeps with `yak admin broker nango <op://…>`.

Nango's key selects its environment. Keep a dedicated, scoped **prod** key in
yaks.app's platform vault; keep **dev** for local development and manual checks.
Automated tests supply an in-memory vault and a fetcher, and use no live key.
The platform's `broker nango` secret is independent of a local graph's secret
with the same name. Changing one does not change the other.

Create the prod key in Nango's **Environment Settings → API Keys**, and save it
in 1Password before copying it with `yak admin broker`. Environment keys cannot
mint another key or change environment settings: those operations require an
Account API key or a signed-in dashboard. The runtime needs integration read and
create, connect-session write, and connection list, read-credentials and delete
permissions. It needs no account, deploy, sync, action or proxy access.

Each environment has its own integrations and connections. Before replacing a
key, configure the same integrations in the destination and inventory the people
whose grants stay behind. Preserve those grants. Nango-managed OAuth apps retain
Nango's callback URL; a custom callback requires an OAuth app of your own.
yaks.app settles brokered sign-ins when it reads connections, so it does not
require a Nango webhook URL.

- `begin` on a brokered integration answers the broker's sign-in link and no
  attempt: the sign-in returns to the broker, not to us.
- `settle(ctx, connection)` asks the broker whether a sign-in finished for a
  needed connection, found by the connection's eid, and connects it with its
  account and granted scopes. Whoever reads a person's connections settles them
  first, so nothing waits on the broker telling us.
- `credential` answers the kept token while it is good for a minute more, and
  otherwise the broker's. `refresh` asks the broker for a new one. A broker that
  says the grant is gone marks the connection `broken`.
- `disconnect` ends the broker's connection after ours. A failure there goes to
  `ctx.report`.
- `signsInWith(vault, read, i)` is what `connectable` is asked with: the broker
  once its key is kept, else the OAuth client.

Changing an integration's `broker`, or removing it, sends only new connections
another way. Each connection keeps working through the broker it was made
through, until its person signs in again.

## The catalog

Every service a person can be offered, connected or not, is one list of offers
(./catalog.ts): the built integrations, and every service a broker lists.
`Broker.catalog()` answers the broker's list as
`Listing{name, title, logo,
categories, hosts, connects, fields, instructions, popular}`,
`logo` the address of an SVG. Nango's comes from its provider list
(`listingOf`): a service it signs in to with an OAuth app of its own (`signin`),
one the person brings an OAuth client for (`client`), or a key (`key`), whose
`fields` and `instructions` come from Nango's credential schema. A way to
connect that hands back no access token is left out.

- `catalogue(built, listings, broker)` merges them, direct first: a built
  integration stands in for the listing of the same name or the one its broker
  names (Gmail for Nango's google-mail), takes that listing's kinds, and is
  featured. A listing reached with a key is direct too: it becomes a pasted key
  kept here and sent only to the listing's hosts, so the broker is never asked.
  Only `signin` and `client` listings are brokered. A listing whose hosts depend
  on the account (`${connectionConfig.subdomain}`) names none and is left out.
- An `Offer` is the integration it would be, plus its `categories`, its logo's
  address (`image`) and whether it is `featured`. `find(offers, words)` ranks a
  title starting with each word first, then a word of the title, then its name
  or kinds, then featured. `kinds` lists the kinds by how many hold them.
- `Broker.enable(integration, connects)` makes the broker ready to sign people
  in to one service: for Nango, an integration made once, through its own app
  for a sign-in.
- `adopted(offer, logo)` is the integration an offer is written as once someone
  connects it: `built`, since only the host writes it, its logo the SVG fetched.
  From then on it is an integration like any other.
- A logo is fetched from `logoSources(address)`, the listing's own first, then
  where the broker also keeps it (Nango's repository, since Nango's CDN can
  answer a missing logo with its web app's page). Only a body `isSvg` holds is a
  logo; a service with none wears `initialLogo(title)`.

## Hosting it

`@yaks/connections/vocab` declares the components and the tools
`connection_need` and `connection_list`; `@yaks/connections/tools` implements
the tools; `@yaks/connections/graph` answers a direct tool call whose answer
names a connection with the integration it goes through too (its `reply`), so an
agent that asked for a connection reads how to get its key;
`@yaks/connections/effects` installs the built integrations when the process
starts. `@yaks/connections/identity` derives an integration's id from its name
for views and other readers, and `@yaks/connections/integrations` lists them
(`listing`) for a reader that holds no connection. A host that composes this
package also composes @yaks/secrets over its vault, the plugin and its effect,
which seals each credential once the write commits and drops it when the
connection is deleted, and @yaks/edge, which derives each `uses` link's id.

## Terminal sign-in

The `./cli` facet declares `yak auth` and loads its implementation when the
command runs. It lists integrations, or signs in to one named by its name or
title. The sign-in link may be opened on another machine; paste the complete
return URL into the masked terminal input.

```sh
yak auth
yak auth openai
yak auth google-calendar
```

Connections belong to the configured person, not to a provider entity.
`signins({g, vault})` holds attempts only in memory and reads credentials
through `pick`. Native sessions use the person's default provider account.
`authorize({graph, vault, owner}, {prepare, callback})` lets a host discover an
integration before sign-in, or return a callback without terminal input. A
callback may include a website session, kept only in the connection's vault
record as `website_session`; it is not the OAuth bearer.
`@yaks/connections/authorize-cli` exports `authorizeCLI`, `authIO`, `readHidden`
and their types for hosts that supply terminal sign-in.

```ts ignore
// A host supplies its graph and vault and may discover integrations in prepare.
import { authorize } from '@yaks/connections'
import { authorizeCLI } from '@yaks/connections/authorize-cli'
let auth = authorize({ graph, vault, owner })
console.log(await authorizeCLI(auth, 'openai'))
```

### yaks.app

`yak auth yaks.app` discovers the MCP resource at `https://yaks.app/mcp`,
registers a public OAuth client, and uses the same masked paste-back flow. The
account's address comes from the discovered `userinfo` endpoint.

```sh
yak auth yaks.app
yak auth yaks.app --as probe-example@bot.yak.sh
```

A `@bot.yak.sh` sign-in needs no browser: the command asks for a code, reads it
from this graph's mail, then grants the request through the ordinary consent
page. This graph must receive that address's mail. The resulting connection
holds OAuth tokens and the website session in its vault; neither reaches graph
text. Browser sign-ins hold only OAuth tokens. `--as` is never required; it only
reaches another account. The terminal-only `./yaks-app` subpath owns MCP
discovery. A supplied website session in its `yaksApp` host seam is for
migrating held sign-ins, not a command-line option.

A pasted agent grant uses the same connection door, with masked input:

```sh
yak auth yaks.app --key
```

The grant never goes on the command line or into a tool-call record.
`YAKS_TOKEN` remains the sandbox's graphless credential.
