# @yaks/mcp-client

Consume remote MCP tools without a harness, session daemon, or MCP server. This
package uses the installed MCP TypeScript SDK's Streamable HTTP client. It
negotiates the SDK-supported protocol revisions; it does not implement the newer
protocol independently or upgrade the workspace SDK.

```ts
import { connect } from '@yaks/mcp-client'

const remote = connect({ name: 'design', url: 'https://example.com/mcp' }, {
  token: async () => credentialFromYourHost(),
})
try {
  const tools = await remote.list()
  const result = await remote.call(tools[0].name, { html: '<h1>Example</h1>' })
  console.log(result)
} finally {
  await remote.close()
}
```

`credentialFromYourHost` above is supplied by the application. There is no
credential file, OAuth flow, or implicit configuration discovery in this
package. Token callbacks are consulted per HTTP request. Redirects are refused;
credentials require HTTPS except for loopback development servers. A rejected
call is not replayed, including after a 401 or a lost session. Recreate the
connection after connection failure; never assume a lost response means a
mutation did not execute.

## Graph and CLI use

`remote.tools()` returns existing `@yaks/graph.Tool` definitions with JSON
Schema `inputSchema` and a `run` handler. They can be passed to the CLI/MCP
graph-tool adapters or invoked directly with the host's execution context. There
is no session dependency and no extra invocation/result vocabulary. Existing
executors own call/result records; this client owns only the protocol
connection.

Remote tool names remain opaque. Local names are deterministic `mcp_` plus a
hash of the server name and exact remote name (64 characters total). The
`meta.server` and `meta.remoteName` fields retain readable identity. Remote
schemas are preserved, including references and annotations; no conversion to
Zod or inference of nouns/verbs from underscores is performed. Runtime argument
validation is the server's responsibility; consumer adapters may validate too.

`clients(servers, options)` composes several named connections. An optional
`allow` array restricts discovery and calls to exact remote names. Discovered
lists are cached and invalidated by `notifications/tools/list_changed`; a host
requests the next snapshot at an execution boundary. `refresh()` on one
connection also invalidates its list. Names must be unique across configured
servers.

## Results and lifecycle

`call` returns the MCP result unchanged, including `isError`,
`structuredContent`, and content blocks. Protocol/transport failures throw
`MCPError`; they are distinct from successful protocol replies carrying
`isError`. Applications must not dump base64 content blocks into a model prompt.
A host can save those bytes in `@yaks/blob` and return artifact references
instead, as the harness adapter does.

Each request defaults to a 60-second deadline. `call` accepts an AbortSignal;
remote cancellation is best-effort, not proof that a side effect was undone.
`close()` closes the SDK transport and attempts to terminate its protocol
session. Hosts should drain admitted calls before closing, and bound forced
shutdown.

This version supports tools over Streamable HTTP only. It does not provide
stdio, legacy HTTP+SSE fallback, prompts/resources browsing, sampling,
elicitation, OAuth registration, automatic reconnect, mutation retries, or
task-based remote tools. Embedded resource content and links can still be
returned by tools. Tool discovery is bounded to 1,000 tools; MCP response bodies
themselves are buffered by the SDK, not byte-streamed into blob storage.
