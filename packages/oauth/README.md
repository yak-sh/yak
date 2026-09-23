# @yaks/oauth

Authorization-flow helpers and private record storage shared by provider
integrations. This package does not implement an OAuth client by itself.

## Exports

Import paths:

- `AuthorizationStore<Record>` from `@yaks/oauth`: the private-record interface,
  with reads and serialized updates.
- `attempt(now?)` from `@yaks/oauth`: a unique correlation value and ten-minute
  deadline.
- `pkce()` from `@yaks/oauth`: a random verifier and its S256 challenge for
  Proof Key for Code Exchange (PKCE). S256 means the challenge is the URL-safe
  Base64 encoding of the verifier's SHA-256 hash.

The implementation is [@yaks/secrets](../secrets)'
`records(graph, vault,
prefix, check?)`: each record is a secret, so the graph
holds its name and a sentinel and the vault holds its contents.

## Example

```ts
import { attempt, pkce } from '@yaks/oauth'

const pending = attempt()
const { verifier, challenge } = await pkce()
// Keep pending and verifier in memory. A protocol adapter includes challenge in
// the authorization URL, checks the returned state and deadline, then sends the
// verifier in its code exchange. These helpers do not perform those checks.
```

`AuthorizationStore<R>.read(key)` returns a record or `undefined`.
`update(key, fn)` passes a mutable record to an asynchronous callback and
returns its result. An implementation serializes updates across every writer and
saves mutations even if the callback throws. Callers must validate a response
before mutating the record if failure should leave it unchanged.

## Storage and security

The store contains sensitive values. The store does not open browsers, accept
HTTP callbacks, select a provider, or execute token exchanges.

`@yaks/mcp-client/oauth` retains MCP discovery, client registration and refresh.
`@yaks/openrouter/oauth` handles OpenRouter's code-to-API-key exchange. Both use
the same private storage and attempt lifetime; they do not pretend to implement
identical protocols. In-flight verifiers remain in memory, never in the store.

## Compatibility

The module uses Web Crypto and `btoa` (modern Deno, Node, browsers, and
Workers).
