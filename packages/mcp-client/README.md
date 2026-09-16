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
credential file or implicit configuration discovery in this package. Token
callbacks are consulted per HTTP request. Redirects are refused; credentials
require HTTPS except for loopback development servers. A rejected call is not
replayed, including after a 401 or a lost session. Recreate the connection after
connection failure; never assume a lost response means a mutation did not
execute.

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
elicitation, automatic reconnect, mutation retries, or task-based remote tools.
Embedded resource content and links can still be returned by tools. Tool
discovery is bounded to 1,000 tools; MCP response bodies themselves are buffered
by the SDK, not byte-streamed into blob storage.

A CLI can assign explicit local noun/verb metadata without guessing the server's
naming convention:

```ts
const tools = (await remote.tools()).map((tool) => ({
  ...tool,
  // Chosen by this application, not parsed from the remote name.
  noun: 'mockup',
  verb: 'publish',
}))
```

For multiple tools, choose a unique pair for each. The `@yaks/cli/structured`
adapter accepts these definitions and an execution callback that invokes
`tool.run(args, context)`. The same original definition remains usable by graph
executors and model adapters without a CLI spelling.

## Browser authorization with a pasted return URL

`@yaks/mcp-client/oauth` provides `authorization(options)`, independently of
sessions or a UI. It uses the MCP SDK for protected-resource and authorization
server discovery, dynamic client registration, PKCE, token exchange, and
refresh. A pre-registered public `clientId` or `clientMetadataUrl` can be
configured when the server does not support dynamic registration.

```ts
import { authorization } from '@yaks/mcp-client/oauth'
import { fileAuthorizationStore } from '@yaks/mcp-client/host'

const login = authorization({
  serverUrl: 'https://example.com/mcp',
  store: fileAuthorizationStore('/home/me/.yaks/mcp-auth.json'),
})
const { url } = await login.begin()
// Display url. The person authorizes in their browser, then supplies the
// complete return URL through a private input, not an agent conversation.
await login.complete(returnUrl)
const token = await login.token() // trusted host code only
```

The default return address is `http://127.0.0.1:8765/oauth/callback`. This flow
starts no HTTP listener: after authorization, the browser may show a connection
error. Copy its full address bar. A server must accept that registered redirect;
configure `redirectUrl` to match a pre-registered client when necessary. A
loopback listener or hosted return page can be supplied by another host. This is
not the deprecated out-of-band OAuth grant.

The pending state/verifier expires after ten minutes and lives only in memory.
Restarting or cancelling requires a new authorization. Callback origin/path,
state, and any issuer parameter are checked before exchanging the code. An
exchange is not replayed after failure. Tokens refresh shortly before a known
expiry; an unsuccessful refresh requires sign-in again. A server revoking a
token before expiry may return an error; mutations are never replayed merely to
try another credential.

`AuthorizationStore` has `read` and serialized `update` operations. The host
implementation uses a versioned JSON file, private file permissions, an advisory
file lock across processes, and atomic file replacement. It is **not
encrypted**. Token expiry is stored with the private record; no OAuth graph
vocabulary is introduced by this first implementation. Application-specific
secret stores can implement the same interface. The access token must only be
passed to trusted request code, never returned as a model tool result.

The configured server controls OAuth discovery. Configure only trusted servers;
HTTP is accepted only for loopback addresses. Discovery requests and token
requests have bounded network deadlines and do not follow redirects. This is not
a general SSRF sandbox or a provider-independent OAuth package.

## Graph server definitions

`@yaks/mcp-client/graph` exports `mcpDoc` and `serverOf(bundle)`. This optional
adapter has no harness or session dependency. Load `mcpDoc` with the host's
vocabulary and store shared server definitions as `mcp_server` components:

```ts
await graph.apply([{
  entity: { eid: 'my-server' },
  mcp_server: { name: 'Example', url: 'https://example.org/mcp' },
}])
```

`serverOf` validates an enabled row and returns its display label, entity ID,
and portable `Server` configuration. `graphToolName` derives a provider-safe
name from the entity, connection configuration, and opaque remote tool name;
hosts can retain handlers for previous configurations without name collisions.
The entity ID is the tool namespace; renaming the display label does not rename
tools. `enabled: false` disables the row. `allow` is optional JSON text
containing an array of exact remote names. OAuth configuration uses
`redirect_url`, `client_id`, `client_metadata_url`, and `scope`; `credential` is
a host-interpreted reference, never a bearer token. Credentials and open
transports remain outside the graph.

Low-level `connect(server)` and `clients(servers)` remain usable without a
graph. The harness reads the shared graph instead of maintaining an
environment-based server list.
