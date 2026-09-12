# OAuth clients, secret access, and authorized HTTP requests

Status: design for review, not an implemented API. No new packages or live
credentials are introduced by this document. Nouns and verbs below are examples,
not a committed vocabulary layout.

## Decisions

- `@yaks/secrets` defines backend interfaces and authorized request injection.
  It does **not** require an encrypted database. The host chooses its backend.
- Normal secret access returns a high-entropy salted-hash placeholder, not the
  secret. Trusted outbound handling substitutes the value at an authorized
  destination. Placeholders are looked up; hashes are not decrypted.
- Explicit raw access remains possible for signing/hashing and other
  integrations that cannot use verbatim substitution. Raw host access does not
  imply a model can read the value.
- `@yaks/oauth` coordinates authorization, token storage references, expiry,
  refresh, and revocation. MCP and provider-specific adapters supply discovery
  and endpoint differences. It is not a session or harness package.
- A generic HTTP tool uses the same authorized fetch interface. It must not
  offer a second credential-policy bypass.
- The CLI, a local worker, a daemon, and a web service can compose these
  packages. No daemon is required. A browser UI requests authorization from its
  trusted host; it does not receive that host's refresh tokens.

## What exists and can be reused

| Existing code                                                | Use or limitation                                                                                                                                                                                                                           |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/mcp-client/mod.ts`                                 | SDK Streamable HTTP client with an injected fetch and bearer-token callback; no interactive OAuth adapter yet.                                                                                                                              |
| Installed `@modelcontextprotocol/sdk` client auth interfaces | `OAuthClientProvider` supplies client registration, tokens, PKCE verifier persistence, authorization redirection, and credential invalidation. Keep MCP protocol handling here rather than copying it into a second generic implementation. |
| `packages/cli/store.ts` and CLI RPC                          | Existing bearer lookup and login command; not a general OAuth broker or encrypted store. Preserve compatibility without silently importing credentials from unrelated programs.                                                             |
| `workers/yak/identity.ts`                                    | Existing OAuth **server** and consent integration using `@cloudflare/workers-oauth-provider`; it is not the proposed OAuth client.                                                                                                          |
| `workers/yak/dispatch.ts`, `workers/yak/tools.ts`            | Existing app-secret set/list/remove delegates to Cloudflare Workers `secret_text` bindings. Values are not ordinary graph properties. These bindings cannot be read back by a separate outbound service.                                    |
| `@yaks/graph.Tool`, `@yaks/tools`                            | Shared command definitions and invocation records; adapters must not create another tool executor.                                                                                                                                          |
| `@yaks/context`, `@yaks/blob`                                | Bounded model-facing output and binary artifacts. Neither is a suitable secret store merely because content is deduplicated.                                                                                                                |

Research also located the earlier destination-bound sentinel/outbound-injection
**design**, not its encrypted database implementation. It specifies injected and
explicit direct modes, including direct access for signing. The checked source
and searched repository history did not identify the encrypted store or the
outbound injector to extract. This is an evidence gap, not a claim they do not
exist. Obtain their location before implementing an encrypted adapter; the
interface design need not wait. No existing generic agent-facing HTTP fetch tool
was found in the inspected packages; specialized provider and MCP fetch clients
already exist.

## Package responsibilities

```text
CLI / graph effect / agent tool / web host
                 |
          OAuth coordinator
          /               
MCP/provider adapter     secret backend + private attempt store
          \               /
          authorized outbound fetch
                 |
             remote API
```

`@yaks/secrets` owns the access and injection contracts, placeholder semantics,
policy evaluation, and outbound request construction. Encryption, filesystem
permissions, external-vault APIs, and key management are adapter
responsibilities. The broker is trusted code, not a sandbox: code holding
unrestricted network and raw-secret capabilities can bypass it. Do not promise
isolation from that code.

`@yaks/oauth` owns reusable grant/attempt lifecycle and host integration. Use a
maintained OAuth implementation for protocol validation rather than writing
cryptographic/protocol primitives. Candidate `oauth4webapi` needs a
dependency/API review before adoption; it is not added here. MCP's installed SDK
already owns its protocol-specific discovery/auth flow and should delegate
storage and host callbacks to this coordinator. Do not run two independent
refresh owners.

MCP's protected-resource discovery and resource indicators remain in
`@yaks/mcp-client`. Google/GitHub adapters configure their supported
registration, scopes, token endpoints, and refresh behavior. OAuth authorization
is not login: OIDC login additionally validates identity tokens, issuer,
audience, nonce, and signatures; it must not infer identity from an arbitrary
access token. Device flow is an additional adapter when advertised, not a
universal replacement for browser consent.

## Secret interface sketch

Illustrative names, not source declarations:

```ts
type SecretRef = string // opaque within one host's backend namespace

type Access = {
  principal: string
  purpose: string
  signal?: AbortSignal
}

type SecretBackend = {
  resolve: (ref: SecretRef, access: Access) => Promise<Uint8Array>
  write?: (value: Uint8Array, access: Access) => Promise<SecretRef>
  remove?: (ref: SecretRef, access: Access) => Promise<void>
}

type SecretAccess = {
  placeholder: (ref: SecretRef, access: Access) => Promise<string>
  fetch: (request: Request, access: Access) => Promise<Response>
  // Only offered to callers with explicit raw-access authority.
  raw?: (ref: SecretRef, access: Access) => Promise<Uint8Array>
}
```

`Access` is constructed/verified by the trusted host, not accepted verbatim from
an agent's tool arguments. Backend raw resolution is internal to the broker;
ordinary callers receive `SecretAccess` without `raw`. A separate, explicitly
authorized reveal tool could expose a value, but doing so puts it into model
context and is not part of the first slice.

An encrypted database, 1Password adapter, or private local `auth.json` can
implement the backend. Report their guarantees honestly: encrypted at rest,
remote access controls, or plaintext with restrictive permissions are different.
Do not require every backend to offer arbitrary transactions, CAS, or rotation.
A read-only backend can use imported credentials; automatic rotating refresh
requires a writable destination or a host-managed companion store. Reject an
unsupported flow before consent rather than fail to save its credentials later.

An encrypted adapter keeps its root key outside the database and defines key
rotation/backup separately. A file adapter rejects unsafe file ownership/modes,
writes atomically with private permissions, and is still plaintext. These are
backend-specific requirements, not mandatory universal encryption.

### Placeholder policy

The prior design calls for a stable, high-entropy salted hash. Specify the
properties before selecting the primitive: do not expose an unsalted digest of a
low-entropy secret; use private salt and a versioned construction. Map the
issued placeholder to its secret reference, authorized principal/app, grant
generation, and destination policy. Detect collisions rather than selecting the
first match. A recognizable reserved prefix allows unknown/expired placeholders
to fail closed without treating ordinary prose as a secret reference.

Stability is within a grant generation, not global across apps or forever across
rotation. Revocation invalidates issuance; expiry and rotation behavior must be
explicit. Possessing the sentinel is not sufficient authority: a leaked value is
not redeemable through another principal's broker. Within the authorized broker
it is usable, so do not advertise it as universally harmless.

Replacement is verbatim in supported URL query values, header values, and
bounded text/form/JSON bodies; the caller need not learn a template language. A
placeholder must never alter the URL scheme, host, port, or path. All
occurrences use one verified resolution per request. Unknown sentinels,
unsupported encoded/transformed placements, and over-limit bodies fail before
sending. Do not claim arbitrary binary/streaming-body replacement in v1.
Remove/recompute length headers after body substitution; reject conflicting
caller authorization headers.

Origin policies use canonical **exact HTTPS origins** by default. Paths,
methods, resource audiences, and allowed injection locations can narrow that
permission. The old design mentioned domain globs: importing them requires
explicit review, not silent broadening. Token endpoint credentials and
resource-server tokens have separate policies. A resource grant must not
authorize sending a refresh token to the resource server.

Redirects default to rejection. A future redirect implementation must recheck
egress and secret policies for every hop, stripping credentials before
constructing the next request. Metadata discovery is unauthenticated until the
selected issuer is validated. Block URL userinfo and unapproved local/private
targets; server-side hosts need DNS/IP enforcement against rebinding and
metadata-service access, not just hostname string matching. Intentional local
MCP servers require explicit local-target policy.

### Direct access and signing

AWS-style signatures cannot be produced by substituting a placeholder after
signing the wrong bytes. A trusted signer can obtain raw bytes through the
explicit capability and sign the final request, or expose a narrow
`sign(request)` adapter that never returns a key. Either is supported; no
mandatory signing proxy. Cryptographic transforms of sentinel text do not work.
A caller explicitly allowed to reveal a raw value accepts the resulting
disclosure; default agent and app access remains placeholder-only.

## OAuth lifecycle

```text
connect request -> validate issuer/client/resource + selected scopes
 -> create private attempt (PKCE S256, state, issuer, redirect, expiry)
 -> public needs-approval status + sanitized authorization URL
 -> host opens browser; user approves
 -> callback validates attempt and exchanges code once
 -> save token set privately; publish nonsecret connected grant metadata
 -> authorized fetch resolves access-token placeholder
```

The host provides browser opening, callback URL/listener, and approval UX. A CLI
uses a short-lived loopback listener with PKCE; a web host uses its registered
HTTPS callback. Callback listeners close after completion/cancellation/timeout.
Store the original issuer and resource alongside state to prevent a callback
from switching issuer. Validate exact redirect policy and PKCE, use state for
correlation and CSRF defense, and OIDC nonce where applicable. Never expose
verifier, codes, refresh/client secrets, or raw callback URLs in generic
graph/tool logs.

Graph records can describe nonsecret provider/grant identity, requested/granted
scopes, status, expiry, and error category. The private attempt/token store owns
sensitive fields. Graph effects can react to explicit
begin/complete/refresh/revoke operations; effects do not infer user approval. A
session is merely one caller.

MCP client registration can be preconfigured, CIMD, or DCR as supported. Version
and discovery policy must follow the negotiated MCP specification and installed
SDK. A discovery document is not authority to send an existing token to a new
host. OAuth authorization to an MCP server and its downstream API credentials
are different grants, never automatic token passthrough.

One broker owns refresh for a grant: serialize within the host, compare the
grant generation before publishing, and install a returned rotating token set
atomically where the chosen store supports it. Multiple processes require shared
coordination or a designated token broker; this is not a promise every backend
offers CAS. After an ambiguous refresh failure, stop and reconcile/re-authorize
rather than blindly reuse a possibly spent refresh token. Revocation cancels
local grant use; remote revocation is attempted when supported, with failures
visible separately. Persisted attempts expire and cannot be redeemed twice.
Restart must not silently repeat an authorization-code exchange whose outcome is
unknown.

## Generic HTTP tool

A portable tool factory accepts an already-authorized fetch function; a host
composes it with `SecretAccess.fetch`. No harness/session dependency. For
example, `noun: 'http', verb: 'request'` with a JSON Schema input object:

- `url`: absolute URL.
- `method`: bounded allowed method string, default GET.
- `headers`: string values, excluding transport-managed/restricted headers.
- `body`: optional bounded text (may contain placeholders); content type
  supplied explicitly. Binary artifact request bodies can follow as a separate
  input.

The tool returns status, safe response headers, media type, and bounded text or
an artifact reference. Store oversized text through existing context handles;
binary responses use external blob artifacts. Enforce wire/decompressed-size and
timeout budgets; do not first buffer an unlimited response then truncate its
display. No credential/ref/principal override is accepted from tool input. No
automatic retry of mutating requests after an ambiguous network failure.

Logs record unresolved requests and nonsecret audit metadata, never resolved
headers/body/query strings. Sanitize errors as well as normal results. An
allowed remote server can echo a credential: v1 must detect/block or redact
known secret bytes in bounded text/headers before returning them; opaque binary
responses on credentialed requests need an explicit policy. This cannot
guarantee removal of encoded/transformed echoes from a malicious allowed
service. Trust in allowed endpoints and raw-access recipients remains part of
the boundary.

## First implementation slice and tests

1. Agree on backend/access contracts, sentinel versioning, allowed locations,
   and failure semantics. Use an in-memory fake backend; do not implement new
   crypto.
2. Implement constrained placeholder fetch and the generic HTTP tool against
   local mock servers. Test wrong principal/origin, URL normalization, redirect,
   unknown sentinel, header/body/query substitution, restricted locations,
   response echo, limits, binary policy, and explicit raw signer access.
3. Connect the installed MCP SDK's OAuth provider hooks to private grant/attempt
   storage and host browser/callback functions. Test consent/cancel/expiry,
   PKCE, issuer mismatch, missing storage capability, rotating refresh
   concurrency, restart during code exchange, and no secrets in graph/sync/log
   output.
4. Supply one chosen storage adapter. Reuse the existing encrypted
   implementation once located; a private file adapter is an explicit
   alternative, not encryption.
5. Verify one configured MCP server end to end with a mock authorization server.
   Live sign-in needs user approval. Google/GitHub and OIDC login are later
   adapter tests, not claimed supported by a successful MCP test.

Open choices: exact JSON vocabulary shape for grants; host identity/access
policy; stable sentinel construction and rotation; encrypted-store source
location; optional raw reveal UX; binary echo policy; SDK-versus-generic refresh
ownership. No daemon, installer, migration, live sign-in, or publishing is part
of this design change.

## Sources and implementation evidence

Protocol references reviewed for this design:

- [MCP authorization, 2026-07-28](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/basic/authorization/index.mdx)
- [OAuth security BCP, RFC 9700](https://www.rfc-editor.org/rfc/rfc9700)
- [OAuth for native apps, RFC 8252](https://www.rfc-editor.org/rfc/rfc8252)
- [Resource indicators, RFC 8707](https://www.rfc-editor.org/rfc/rfc8707)
- [OAuth protected resource metadata, RFC 9728](https://www.rfc-editor.org/rfc/rfc9728)
- Installed MCP SDK 1.29.0 `client/auth.d.ts`: `OAuthClientProvider` hooks.

Repository evidence is the source paths in the first table. Maintainer lookup:
prior outbound/injected-secret design records are T-33445, T-33446, T-33448 in
the existing project graph; all were open at inspection. They are provenance,
not a prerequisite for understanding or using the proposed public packages. The
design search did not read credential values or open/migrate the live
application DB.
