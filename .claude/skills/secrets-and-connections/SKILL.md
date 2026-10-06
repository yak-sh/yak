---
name: secrets-and-connections
description: >
  How a key, token, password or other credential is kept and used, on the box
  and on yaks.app: @yaks/secrets (`secret{name, value}`, the vault, handles and
  sentinels, `reveal`, `{"secret": "NAME"}` in a config, `op://` references),
  connections and integrations (@yaks/connections), the swap on the way out
  (@yaks/egress, `./api/env`, `./api/fetch`), and where an environment variable
  is still right. Use it whenever you are about to read `Deno.env` or
  `process.env` for a key or token, add an API key, credential, password or
  token to anything, wire a new integration, provider or OAuth client, set an
  app's secret (`app_secret_set`, `connection_need`), touch `~/.yak/secrets` or
  a vault, or debug a call failing on auth (a 401, the egress's 403, "not
  connected"), even when the request never says "secret". Re-keying what people
  hold is `data-migration`; the kernel Worker in general is `yaks-app`; wiring a
  plugin is `packages-and-plugins`.
---

# Secrets and connections

A credential is something we hold for someone: the owner's account keys, a
person's calendar sign-in, the API key an app builder pasted. What we built
around that is one idea, pushed all the way through: the value rests in exactly
one place, and everything else holds a stand-in that is worthless to steal.
Treat a value like something hot. It passes through at the moment it is used,
on its way into a request, and never settles anywhere it could be read back: a
bundle, a log line, an error message, a transcript.

What we're proud of here: a leaked sentinel that means nothing, a key rotated
without a restart, a new service added as a row of data. What makes us wince:
`Deno.env.get('SOME_KEY')` by reflex, a key pasted into a chat, a token in a
stack trace.

## The shape

A secret is an entity wearing `secret{name, value}` (packages/secrets). It is
written with its value like any other write. The @yaks/secrets plugin takes the
value out in `normalize`, the first phase of `apply()`, puts the secret's
**handle** where it was, and once the write commits seals the value into the
host's **vault**. The graph, its journal, its sync and its backups only ever
hold the handle: `yak_secret_` and 256 random bits, kept across every rotation
of the value and safe to show anyone. The eid is derived from the name
(`secretEid`), so one name is one secret and nobody looks an id up. The file
headers in packages/secrets are the reference; it has no README.

Code uses a secret two ways. Trusted code that needs the value asks for it by
name at the moment it is used (`reveal`). Code that calls out without holding
the value is handed a **sentinel** instead: `yak_sentinel_`, the handle hashed
under the vault's salt, which a swap on the way out replaces with the value. The
salt never leaves the vault, so nobody reading the graph can make a sentinel,
and one that leaks is useless.

You reach for `Deno.env.get('SOME_KEY')` because nearly every codebase you have
read does. Here it is usually the wrong door. An environment variable is fixed
when the process starts, so a new key needs a restart; it is inherited by every
child the process starts; it cannot say which hosts it may go to; and a yaks app
on yaks.app has no process environment at all. A secret written through the
graph arrives while the process runs, rotates behind the same handle, is gone
when its entity is deleted, and can be scoped by a sentinel.

## Where the value rests

- **The box**: one private file per secret in `secrets/` beside the database
  (`~/.yak/secrets` for `~/.yak/yak.db`), plus the salt (packages/cli/vault.ts:
  directory 0700, files 0600, symlinks refused). A graph in memory keeps them in
  memory. A probe's vault sits beside the probe's database, so it holds none of
  the box's secrets.
- **The box's backup leaves the vault out** (`~/.yak/.gitignore` ignores
  everything it does not name). A value kept only there is lost with the box.
- **1Password**: a value written as `op://<vault>/<item>/<field>` is kept as
  that reference and read with `op read` each time it is used, cached for 30
  seconds (packages/secrets/op.ts, reveal.ts `TTL`). The value never rests on
  the box. A failed read is a missing secret, never a fall to the environment.
- **yaks.app**: the directory's store (`yak/platform`) seals into the `VAULT` D1
  database, every value encrypted under `VAULT_KEY` (packages/d1/vault.ts,
  workers/yak/vault.ts). An app's own store runs no secrets plugin and keeps no
  key (workers/yak/graph.ts). Without both bindings the vault is shut and a key
  is refused before anything commits.

## Reading one

`reveal(vault, name)` answers from three places, first match wins
(packages/secrets/reveal.ts): the value the vault keeps, the `op://` reference
it keeps (read now), then the environment variable of the same name. The
fallback is why a name a service exports needs nothing written, and why writing
the name through the graph overrides the export. It is a fallback, not where a
new key goes, and on yaks.app there is no environment to fall to.

- **In a config** (`~/.yak/yak.json`, a plugin's `with`), a key is `{"secret":
  "NAME"}` where the value would go. The CLI host reads it each time the
  property is read (packages/cli/host.ts `revealing`, @yaks/secrets `peek`), and
  reads the 1Password ones it binds once at start (`warm`). A plugin that
  re-reads its options picks up a key written after start without a restart. A
  name nobody supplied reads `undefined`, and the plugin says what it is waiting
  for. Mail, tunnel and embedding take their tokens this way
  (packages/mail/README.md, packages/embedding/README.md).
- **In a plugin's code**, `reveal(host.vault, 'NAME')` at the moment of use,
  not at import, so a rotation lands on the next call and the value lives no
  longer than the request it goes into.
- **A record that changes**, such as OAuth tokens, is `records(g, vault, prefix,
  check)`: JSON kept as a secret and updated under `vault.lock`, so two
  processes refreshing one token never spend each other's refresh token
  (packages/secrets/records.ts; @yaks/oauth's store is this).

## Writing one on the box

The write doors are `graph_apply` and `yak graph apply`. Both take an optional
`doc{title, body}` beside `secret{name, value}` in the same bundle (T-64284):
a human title, and a body saying what the secret is for and which packages or
services use it. `secret.name` stays the config key and the identity. The doc
is the secret's public face: listings show the name and the title, never the
body, the value or even the handle (packages/secrets/views.ts), so the doc
carries the purpose and nothing that is the credential.

Write a reference, not a value:

```sh
yak graph apply --bundles '[{"entity":{"eid":"$s"},"secret":{"name":"NAME","value":"op://<vault>/<item>/<field>"},"doc":{"title":"Service access","body":"Used by the service integration to authenticate outgoing requests."}}]'
```

The plugin also strips a value out of `graph_apply`'s own call record, so the
graph never holds it either way. Your transcript does: the command you ran is
in it, and @yaks/session imports transcripts into the graph, scrubbing only the
credential shapes it recognizes (packages/session/readers.ts `scrub`). A value
an agent typed is a value leaked, and so is one the owner pasted into a chat.
So an agent writes an `op://` reference, and a person enters a value where no
transcript sees it: `yak auth [name]` takes a sign-in's return URL as masked
input, `yak auth --key` takes an agent grant or service key the same way, and
yaks.app's connections page takes a pasted key.

To check one: `yak graph query '.secret.name=NAME&*'`. It wears `provisional`
while its value is on the way to the vault, `error` while a seal is retried,
and `exception` with `content` when the seal failed for good; the value is then
gone and has to be given again. Deleting the entity, or its `secret` component,
drops it from the vault (`unsealed(name)` is that bundle).

## Connections: a credential for an outside service

A key or sign-in for an outside service is a **connection**
(packages/connections/README.md): `connection{integration, owner, account,
scopes, status}` on an entity that also wears `secret{name, value}`, its name
`connection:` and a random id. The value is the handle of a pasted key, or of
the OAuth tokens kept as a record. An **integration** is the service as data,
and its `hosts` are the only hosts its credential may be sent to.

A new service is data, not code. The owner, verbatim (M-39503): "We implemented
oauth once, and the providers are specified via data. You can see this
principle as the primary inspiration of this entire project." A built
integration is a seed JSON (packages/connections/openrouter.json,
google-calendar.json, openai.json) that `install` writes into the graph; a
custom one is made by `need` with its `hosts`. @yaks/oauth is the one OAuth
implementation, and a provider is a row in it. When a new service seems to want
its own OAuth client in code or its own environment variable, that's the
signal to give it a row instead.

- **An OAuth client** is a secret, `oauth_client <name>`. yaks.app's is kept
  with `yak admin client <name> <id> [secret] --as admin@bot.yak.sh`, whose id
  and secret are `op://` references read there and never printed.
- **On the box**, the harness's sign-ins (OpenAI, OpenRouter, MCP servers) are
  connections in the box's vault; `yak auth` lists them and signs in. Nothing on
  the box swaps a sentinel for an agent's own fetch yet (T-39537).

## yaks.app: calling out without holding the key

An app never holds a key. It says what it needs with `connection_need`; the
person pastes the key or signs in at
`https://yaks.app/manage/connections?space=<slug>`, and `connection_attach`
grants one the space already has. What app builders read is the guide's
"Keys" section (workers/yak/public/docs/code.md).

- The app is handed a sentinel per binding: `env.NAME` in its worker, set as a
  Workers secret on the app's script (workers/yak/connections.ts `rebind`), or
  from `./api/env` in a page.
- Every fetch a worker makes leaves through the outbound Worker; a page sends
  its call to `./api/fetch?url=…` (workers/yak/outbound.ts). @yaks/egress
  `forward` swaps the sentinel for the credential only for a connected
  connection the app uses, a caller allowed to call out through it, and https to
  a host its integration names; it follows no redirect
  (packages/egress/README.md).
- `direct: true` hands the worker the key itself, for a key it must sign with
  (a request signature, SigV4, Basic auth). Only a pasted key shared by everyone
  may be direct.
- `app_secret_set`, `app_secret_list` and `app_secret_remove` are translations
  kept for the published listing (M-37853, workers/yak/published.ts):
  `app_secret_set` makes a direct connection named for the binding. New work
  uses `connection_need`. T-34353 is the open problem with a tool that takes a
  key as an argument.
- The write log never keeps a write that carries a value (workers/yak/writes.ts
  `keyed`, @yaks/secrets `carries`).

## Where an environment variable is still right

The environment is right where the vault can't be: for the keys that open the
vault, for what an outside program reads on its own, and for a grant that dies
with the child it was handed to.

- **The kernel Worker's own credentials** are Worker secrets, set with `npx
  wrangler secret put` and read off `env` (workers/yak/env.ts; the table in
  workers/yak/README.md, "Everything set by hand"). `VAULT_KEY` is among them
  because it opens the vault and cannot live inside it.
- **What 1Password itself needs**: `op` runs with a cleared environment but for
  `PATH`, `HOME`, `XDG_CONFIG_HOME` and `OP_SERVICE_ACCOUNT_TOKEN`.
- **A short-lived grant handed to a child**: the build sandbox's `YAKS_TOKEN`
  dies with its container (workers/yak/sandbox.ts). The `yak` CLI reads
  `YAKS_TOKEN` before the selected yaks.app connection; a graphless machine
  makes a personal account graph on first `yak auth` (packages/cli/accounts.ts).
- **Outside CLIs** a managed spawn runs (Claude Code, the Codex CLI) find their
  own logins through `HOME`.
- **A tool a person runs**: `STRIPE_KEY` for the Stripe sandbox (the `testing`
  skill), `JSR_TOKEN` for `deno task jsr`. Local Worker secrets go in
  `workers/yak/.dev.vars`, which git ignores.

## Whose keys these are

- **The repo is public, and stays that way** (M-37867: security never rests on
  the code being hidden). So a value belongs in `secret.value` and nowhere else:
  not a commit, a task, a comment, a memory, a brief, an error message or any
  other bundle (M-17876). History can't be unpublished, so a secret found in it
  is rotated, not hidden.
- **The owner's keys are his, and they live here** (M-4524).
  `~/code/holdco/.env` and the owner's 1Password stay on this server: they are
  not embedded, sent or reused anywhere else. A service that needs access gets
  a newly minted key scoped to that one service, not the account key, and an
  owner-configured credential keeps the auth he gave it.
- **What people hold keeps working** (M-37923). Sessions, the CLI's bearer,
  sign-in links and a letter's tickets are sealed under keys derived from
  `SESSION_SECRET` (workers/yak/lib/token.ts); every kept key is encrypted under
  `VAULT_KEY`, which the README marks never changed; every sentinel an app was
  handed is a handle hashed under its vault's salt. Rotating any of them, or
  changing how a token is sealed, a value is encrypted or a sentinel is derived,
  breaks what people hold. So such a change is a migration in which the old
  form keeps working until it could have expired, as
  workers/yak/lib/token_legacy.ts does (`data-migration` has the craft). One
  that can't avoid a break is the owner's call before it lands.

## When a call fails on auth

- **"yaks.app refused this call: …" (403)**: the egress refused. The host is not
  one the integration names, the app does not use that connection, the
  connection is another person's own, the caller has no level on the app and
  the link is not open to anyone, or it is not https.
- **The service received `yak_sentinel_…` verbatim**: the call never passed the
  egress. A page fetched the service directly instead of through `./api/fetch`,
  or a process on the box sent a sentinel nothing swaps.
- **A connection `broken`**: the service refused the grant; the person connects
  it again. A failure on the wire does not break it.
- **`{"secret": "NAME"}` reads `undefined`**: nothing was written for that name,
  no variable of that name is exported, or `op read` failed (the process that
  read it logs `@yaks/secrets — op read failed`). A probe's own vault starts
  empty.
- **"OpenAI is not connected"**: the harness has no OpenAI sign-in; `yak auth`.

When this skill is wrong or missing something, fix it in the same change.
