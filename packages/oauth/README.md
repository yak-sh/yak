# @yaks/oauth

Small authorization utilities shared by protocol-specific integrations:

- `AuthorizationStore<Record>`: serialized private record reads/updates.
- `attempt(now?)`: a unique correlation value and ten-minute deadline.
- `pkce()`: a random verifier and its S256 challenge.
- `@yaks/oauth/host.fileAuthorizationStore(path, validate?)`: a private JSON
  implementation with a file lock, atomic replacement, and optional record
  validation.

The store contains sensitive values and is not a graph or synchronization store.
Files use private permissions but are plaintext. The caller supplies a dedicated
path and owns the lifecycle. The store does not open browsers, accept HTTP
callbacks, select a provider, or execute token exchanges.

`@yaks/mcp-client/oauth` retains MCP discovery, client registration and refresh.
`@yaks/openrouter/oauth` handles OpenRouter's code-to-API-key exchange. Both use
the same private storage and attempt lifetime; they do not pretend to implement
identical protocols. In-flight verifiers remain in memory, not these files.
