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

## Where the value is kept

- **The box**: one private file per secret in `secrets/` beside the database
  (`~/.yak/secrets` for `~/.yak/yak.db`), plus the salt (packages/cli/vault.ts:
  directory 0700, files 0600, symlinks refused). A graph in memory keeps them in
  memory. A probe's vault is beside the probe's database, so it holds none of
  the box's secrets.
- **The box's backup leaves the vault out** (`~/.yak/.gitignore` ignores
  everything it does not name). A value kept only there is lost with the box.
- **1Password**: a value written as `op://<vault>/<item>/<field>` is kept as
  that reference and read with `op read` each time it is used, cached for 30
  seconds (packages/secrets/op.ts). The value never rests on the box. A failed
  read is a missing secret, never a fall to the environment.
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
the name through the graph overrides the export. On yaks.app there is no
environment to fall to.

- **In a config** (`~/.yak/yak.json`, a plugin's `with`), a key is `{"secret":
  "NAME"}`, never the value. The CLI host reads it each time the property is
  read (packages/cli/host.ts `revealing`, @yaks/secrets `peek`), and reads the
  1Password ones it binds once at start (`warm`). A plugin that re-reads its
  options picks up a key written after start without a restart. A name nobody
  supplied reads `undefined`, and the plugin says what it is waiting for. Mail,
  tunnel and embedding take their tokens this way (packages/mail/README.md,
  packages/embedding/README.md).
- **In a plugin's code**, `reveal(host.vault, 'NAME')` at the moment of use,
  never at import. The value goes into the request and nowhere else: not a
  bundle, a tool's answer, a log line or an error message.
- **A record that changes**, such as OAuth tokens, is `records(g, vault, prefix,
  check)`: JSON kept as a secret and updated under `vault.lock`, so two
  processes refreshing one token never spend each other's refresh token
  (packages/secrets/records.ts; @yaks/oauth's store is this).

## Writing one on the box

Write a reference, not a value:

```sh
yak graph apply --change '[{"entity":{"eid":"$s"},"secret":{"name":"NAME","value":"op://<vault>/<item>/<field>"}}]'
```

The plugin also strips a value out of `graph_apply`'s own call record, so the
graph never holds it either way. Your transcript does: the command you ran is in
it, and @yaks/session imports transcripts into the graph, scrubbing only the
credential shapes it recognizes (packages/session/readers.ts `scrub`). A value
an agent typed is a value leaked. So an agent writes an `op://` reference, or
the person enters the value where no transcript sees it: `yak auth [name]` takes
a sign-in's return URL as masked input, and yaks.app's connections page takes a
pasted key. Never ask the owner to paste a key into a chat.

To check one: `yak graph query '.secret.name=NAME&*'`. It wears `provisional`
while its value is on the way to the vault, `error` while a seal is retried, and
`exception` with `content` when the seal failed for good; the value is then gone
and has to be given again. Deleting the entity, or its `secret` component, drops
it from the vault (`unsealed(name)` is that bundle).

## Connections: a credential for an outside service

A key or sign-in for an outside service is a **connection**
(packages/connections/README.md): `connection{integration, owner, account,
scopes, status}` on an entity that also wears `secret{name, value}`, its name
`connection:` and a random id. The value is the handle of a pasted key, or of
the OAuth tokens kept as a record. An **integration** is the service as data,
and its `hosts` are the only hosts its credential may be sent to.

- **A new service is data.** A built integration is a seed JSON
  (packages/connections/openrouter.json, google-calendar.json;
  packages/harness/openai.json) that `install` writes into the graph; a custom
  one is made by `need` with its `hosts`. OAuth is implemented once
  (@yaks/oauth) and each provider is a row (M-39503): never a new OAuth client
  in code, and never a new environment variable per provider.
- **An OAuth client** is a secret, `oauth_client <name>`. yaks.app's is kept
  with `yak admin client <name> <id> [secret] --admin`, whose id and secret are
  `op://` references read there and never printed.
- **On the box**, the harness's sign-ins (OpenAI, OpenRouter, MCP servers) are
  connections in the box's vault; `yak auth` lists them and signs in. Nothing on
  the box swaps a sentinel for an agent's own fetch yet (T-39537).

## yaks.app: calling out without holding the key

An app never holds a key. It says what it needs with `connection_need`; the
person pastes the key or signs in at
`https://yaks.app/manage/connections?space=<slug>`, and `connection_attach`
grants one the space already has. What app builders read is the guide's section
on calling out (workers/yak/public/docs/code.md).

- The app is handed a sentinel per binding: `env.NAME` in its worker, set as a
  Workers secret on the app's script (workers/yak/connections.ts `rebind`), or
  from `./api/env` in a page.
- Every fetch a worker makes leaves through the outbound Worker; a page sends
  its call to `./api/fetch?url=…` (workers/yak/outbound.ts). @yaks/egress
  `forward` swaps the sentinel for the credential only for a connected
  connection the app uses, a caller allowed to call out through it, and https to
  a host its integration names; it follows no redirect
  (packages/egress/README.md).
- `direct: true` hands the worker the key itself, for a key it must sign with;
  only a pasted key shared by everyone may be direct.
- `app_secret_set`, `app_secret_list` and `app_secret_remove` are translations
  kept for the published listing (M-37853, workers/yak/published.ts):
  `app_secret_set` makes a direct connection named for the binding. New work
  uses `connection_need`. T-34353 is the open problem with a tool that takes a
  key as an argument.
- The write log never keeps a write that carries a value (workers/yak/writes.ts
  `keyed`, @yaks/secrets `carries`).

## Where an environment variable is still right

- **The kernel Worker's own credentials** are Worker secrets, set with `npx
  wrangler secret put` and read off `env` (workers/yak/env.ts; the table in
  workers/yak/README.md, "Everything set by hand"). `VAULT_KEY` is among them
  because it opens the vault and cannot live inside it.
- **What 1Password itself needs**: `op` runs with a cleared environment but for
  `PATH`, `HOME`, `XDG_CONFIG_HOME` and `OP_SERVICE_ACCOUNT_TOKEN`.
- **A short-lived grant handed to a child**: the build sandbox's `YAKS_TOKEN`
  dies with its container (workers/yak/sandbox.ts). The `yak` CLI reads
  `YAKS_TOKEN` before the token `yak login` saved; a CLI speaking to a remote
  host has no vault of its own (packages/cli/store.ts).
- **Outside CLIs** a managed spawn runs (Claude Code, the Codex CLI) find their
  own logins through `HOME`.
- **A tool a person runs**: `STRIPE_KEY` for the Stripe sandbox (the `testing`
  skill), `JSR_TOKEN` for `deno task jsr`. Local Worker secrets go in
  `workers/yak/.dev.vars`, which git ignores.

The box's fallback to an environment variable of the same name is a fallback,
not where a new key goes: an exported key needs a restart to change, and a key
written through the graph does not.

## What binds here

- **Never in the repo, never in the graph's text.** No value in a commit, a
  task, a comment, a memory, a brief, an error message or any bundle but
  `secret.value` (M-17876). A secret found in git history is rotated, not hidden
  (M-37867).
- **Owner keys stay on this server.** `~/code/holdco/.env` and the owner's 1Password
  are never embedded, sent or reused off the box. A service that needs access
  gets a newly minted key scoped to that one service, never the account key, and
  an owner-configured credential's auth is never changed (M-4524).
- **What people hold keeps working** (M-37923). Sessions, the CLI's bearer,
  sign-in links and a letter's tickets are sealed under keys derived from
  `SESSION_SECRET` (workers/yak/lib/token.ts); every kept key is encrypted under
  `VAULT_KEY`, which the README marks never changed; every sentinel an app was
  handed is a handle hashed under its vault's salt. Rotating any of them, or
  changing how a token is sealed, a value is encrypted or a sentinel is derived,
  breaks what people hold. Such a change is a migration in which the old form
  keeps working until it could have expired, as workers/yak/lib/token_legacy.ts
  does, and one that cannot avoid a break is the owner's call before it lands.

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
