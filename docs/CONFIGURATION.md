# Runtime configuration

Tasks needs two different kinds of configuration. An Ollama base URL is a
shareable graph fact. An Ollama API key is a credential. Giving both the same
storage and wire contract would either make ordinary settings hard to use or put
secrets in snapshots, browser caches, journals, and backups.

This design keeps one catalog and two storage planes.

## Decisions

### Known settings, not an environment editor

A server-owned catalog defines every setting Tasks understands: key, label,
group, type, default, validation, sensitivity, and help text. The first entries
are `OLLAMA_BASE_URL` and `OLLAMA_API_KEY`. Provider code asks the configuration
service for a catalog key; it does not read `Deno.env` directly.

The catalog is code because it is part of the executable contract. The UI must
not offer arbitrary environment variables or let data invent a setting that no
consumer understands. Adding a setting means adding one catalog entry and wiring
one consumer, after which both clients can render it.

### Ordinary values are graph data

Non-secret overrides live on setting entities in SQLite and travel through the
normal graph mutation and broadcast path. A `setting {key, value}` component,
unique by key, is enough; its `doc` supplies the human title and description.
This makes changes durable, visible to web and TUI together, and effective in a
running server without a second configuration database.

Resolution order is:

1. a graph override;
2. the process environment, for deployment compatibility;
3. the catalog default.

Deleting an override reveals the environment or default again. The UI reports
that source so “reset” is not mistaken for an empty value. Values are validated
at the server boundary as well as in the client. Base URLs allow only HTTP or
HTTPS, reject credentials, query, and fragment, and are normalized before a
provider appends its path.

The graph has no authorization layer and is deliberately deployed on a private
tailnet. Configuration inherits that trust boundary; this design does not claim
to make an internet-exposed Tasks server safe.

### Secrets never become graph components

Secret bytes and secret references stay behind a dedicated server API. They do
not enter `/snapshot`, `/query`, `/apply`, websocket patches, graph journals,
logs, errors, child environments, prompts, or provider request bodies. A read
returns only state such as `configured`, `missing`, or `unavailable`, the source
kind, and a scrubbed diagnostic. A write is one-way: secret inputs are never
echoed or prefilled.

The API is JSON-only, size-bounded, `Cache-Control: no-store`, and uses the same
redaction discipline as provider accounts. Logs name a catalog key and backend,
never a value or reference. Tests use canaries to prove those boundaries.

The initial secret backends are:

- **local** — the OSS default. Store plaintext in an atomically replaced,
  server-only file under the Tasks state directory: root mode `0700`, file mode
  `0600`, no symlinks. This matches the existing Codex credential threat model.
  Encrypting with a key beside the ciphertext would be security theatre. Full
  disk encryption or a platform credential manager can strengthen the host.
- **environment** — a read-only compatibility source. Existing deployments
  continue to work, and the panel can say that a value came from the service
  environment without revealing it.
- **1Password** — an optional binding resolved with `op read op://…`. The
  binding metadata is server-only too: vault, item, and field names can disclose
  useful infrastructure details even when they are not secret bytes.

An explicit local or 1Password binding overrides an environment value; removing
it reveals the environment again. Deleting a local secret overwrites the
application's reference to it but cannot promise forensic erasure from the
filesystem, snapshots, or host backups. The UI says so plainly.

### 1Password is an adapter, not a requirement

1Password documents secret references and `op read` as its smallest runtime
integration. For an unattended daemon, its recommended least-privilege shape is
a service account restricted to the required vault. The service-account token is
a bootstrap credential supplied to `tasksd`, not another secret stored by Tasks.
A personal installation may instead use an already authenticated CLI, but the
daemon must not launch an interactive sign-in.

1Password Connect adds a self-hosted cache and REST service. It is useful at a
larger deployment scale but is too much infrastructure for the default path. The
1Password SDK has the same service-account bootstrap concern. Neither removes
the need for an initial machine credential. A general OAuth login is not the
documented secrets-automation path, so Tasks should not invent one.

The resolver runs `op` without a shell, with a minimal allowlisted environment,
a deadline, bounded stdout, and discarded bounded stderr. It accepts only an
`op://` reference. A short cache prevents one subprocess per provider request;
save, reset, and an explicit refresh invalidate it immediately, while expiry
picks up rotation in 1Password without restarting Tasks. A failed refresh does
not silently turn an old credential into a permanent value.

Credential Broker may eventually replace long-lived service-account tokens with
short-lived machine access. It should be a later backend after its runtime and
deployment contract are proven, not a reason to delay the simple adapter.

### Changes take effect at the next use

Configuration is read at operation boundaries, not captured when `server.ts`
imports. A running provider request keeps the values it started with; the next
readiness probe, spawn, or request sees the new generation. Secret cache
invalidation and graph broadcasts make a successful save immediately observable.
No daemon restart is part of an ordinary save flow.

`OLLAMA_BASE_URL` therefore replaces the hard-coded hosted base, and
`OLLAMA_API_KEY` replaces the direct environment callback. Provider readiness
uses the same resolver as transport so the menu cannot claim ready while the
request path disagrees. A “test” action performs a bounded provider-safe probe
and reports a redacted result before the user starts a session.

Process-birth settings remain outside this facility: database path, listen port,
state directory, executable search path, and the credential that lets the daemon
bootstrap an external secret backend. Moving one of those at runtime would
require moving the process itself and is not promised by this design.

## Configuration panel

The sidebar's anchored **Codex account** row becomes **Configuration** in web
and TUI. The panel is generated from the shared catalog and groups provider
accounts, endpoints, and credentials. The existing Codex login state machine
becomes the Codex section rather than a separate product surface.

Each row shows effective source and readiness. Ordinary values can be edited,
saved, or reset. Secret rows offer replace, remove, choose local/environment/
1Password, test, and refresh; they show a fixed configured marker rather than a
masked copy whose length could leak. TUI entry is masked and held only in its
mounted input state. Neither client persists draft secrets.

On first run, an installation with no usable managed provider opens the same
panel as onboarding: sign in to Codex, paste a provider key into the local
store, bind a 1Password reference, or keep using an installed CLI fallback.
1Password is an enhancement, never a prerequisite. Documentation gives a
copyable local path first and a least-privilege service-account recipe second.

## Delivery order

1. Add the catalog, graph setting component, resolver, validation, source
   reporting, and hot-change tests.
2. Add the server-only credential API and local/environment backends with
   boundary and redaction tests.
3. Move Ollama base URL, key, readiness, and transport onto the resolver.
4. Replace the Codex sidebar entry with the shared web/TUI configuration panel
   and preserve the existing account ceremonies inside it.
5. Add onboarding, operator documentation, diagnostics, and end-to-end tests.
6. Add the optional `op read` backend. It may ship independently after the local
   vertical slice; it must not block easy OSS onboarding.

The first release is complete when a new user can configure Ollama locally in
either UI, start a session without restarting `tasksd`, reload both clients
without seeing secret material, reset to an environment value, and obtain a
useful redacted failure when the provider is unreachable.

## Rejected alternatives

- **Put API keys in graph rows.** Every graph reader and backup would receive
  them, and the product currently has no authorization boundary.
- **Store all configuration in an opaque file.** Safe for secrets, but ordinary
  values would bypass the graph, live broadcast, CLI, and existing editors.
- **Require 1Password.** It makes onboarding and self-hosting depend on a paid
  external product and still needs a machine bootstrap credential.
- **Use Connect by default.** It adds two services and deployment credentials to
  solve a one-daemon problem already handled by `op read`.
- **Encrypt local secrets with an auto-generated adjacent key.** This protects
  neither a compromised process nor a stolen state directory and creates false
  confidence.
- **Re-read arbitrary environment variables through the UI.** It exposes process
  internals and creates an untyped remote-control surface with no consumer
  contract.
