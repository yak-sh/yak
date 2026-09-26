# @yaks/mcp-client

`@yaks/mcp-client` connects to remote Model Context Protocol (MCP) servers over
Streamable HTTP and exposes their tools as portable `@yaks/graph.Tool`
definitions. It uses the installed MCP TypeScript SDK for protocol negotiation
and requires no session daemon, harness, graph, or local MCP server.

```sh
deno add jsr:@yaks/mcp-client
```

Entry points:

- `@yaks/mcp-client`: connections, discovery, calls, naming, and error types.
- `@yaks/mcp-client/oauth`: where a server signs in, as data.
- `@yaks/mcp-client/graph`: optional graph-backed server configuration.
- `@yaks/mcp-client/vocab`: the graph vocabulary document alone.

This example talks to a server over the network, so it is not run as a test:

```ts ignore
import { connect } from '@yaks/mcp-client'

const remote = connect({ name: 'design', url: 'https://example.com/mcp' }, {
  token: async () => credentialFromYourHost(),
})
try {
  const tools = await remote.list()
  // This example server is assumed to advertise render_html with an html argument.
  console.log(tools.map((tool) => tool.name))
  const result = await remote.call('render_html', {
    html: '<h1>Example</h1>',
  })
  console.log(result)
} finally {
  await remote.close()
}
```

`credentialFromYourHost` is application code that returns the credential for
this server. The application supplies credentials; the package does not search
config files. The token callback runs for every HTTP request. Credentials
require HTTPS except on loopback hosts and are never forwarded across origins.
Redirects are refused.

A failed call is never replayed, because a lost response does not prove that a
remote mutation failed. Recreate the connection after a connection failure.

## Graph and CLI use

`remote.tools()` returns `@yaks/graph.Tool[]`. Each definition contains the
remote JSON Schema `inputSchema`, MCP annotations, connection metadata, and a
`run` handler. Existing graph, CLI, and model adapters can execute these tools;
this package adds no invocation or result components.

A **bundle** is one entity's components represented as a JSON object. A tool's
`run` method returns bundles containing its text and structured output. Call
`remote.call()` when the application needs the complete MCP result, including
non-text content blocks.

Remote protocol names remain unchanged in `tools/call`. Exposed local names
combine a normalized namespace with the exact remote name: `yaks.app` and
`app_list` become `yaks_app__app_list`. Duplicate normalized namespaces or
exposed names are rejected. Invalid remote characters and names longer than 64
characters produce errors. Set `Server.namespace` to choose a shorter local
namespace and `label` to change descriptions. `meta.server` and
`meta.remoteName` preserve connection identity and the protocol name.

Remote schemas and annotations are preserved. The client does not infer CLI
nouns or verbs, convert schemas to Zod, or validate call arguments. The remote
server remains responsible for runtime argument validation.

`clients(servers, options)` combines several connections. Server names and
normalized namespaces must be unique. A server's optional `allow` array limits
discovery and calls to exact remote names. Tool lists are cached until a
`notifications/tools/list_changed` notification arrives or `refresh()`
invalidates one connection. Discovery is limited to 1,000 tools.

A CLI can add explicit noun and verb metadata, mapping each of `remote.tools()`
to `{ ...tool, noun: 'mockup', verb: 'publish' }`. Choose a unique pair for
every tool. The `@yaks/cli/structured` adapter can execute
`tool.run(args, context)`; the definitions remain usable by adapters that do not
use CLI names.

## Results and lifecycle

`call` returns the MCP result unchanged, including `isError`,
`structuredContent`, and content blocks. Protocol and transport failures throw
`MCPError`; an MCP reply with `isError` is still a successful protocol reply.
Applications should store large or base64 content blocks outside a model prompt,
for example in `@yaks/blob`, and return artifact references.

Requests default to a 60-second deadline. `call` accepts an `AbortSignal`.
Cancellation is best-effort and does not prove that a remote side effect was
undone. `close()` attempts to terminate the protocol session and closes the SDK
transport. Let accepted calls finish before orderly shutdown.

This version supports tools over Streamable HTTP. It does not support stdio,
legacy HTTP+SSE fallback, prompt or resource browsing, sampling, elicitation,
automatic reconnect, mutation retries, or task-based remote tools. Tools may
still return embedded resource content and links. The SDK buffers response
bodies in memory.

## Where a server signs in

`@yaks/mcp-client/oauth` exports `discover(url, challenge?, fetch?)`. It finds
where an MCP server signs in the way the MCP spec says: the server's
protected-resource metadata (RFC 9728, or the URL a 401 challenge names) points
at the authorization server, whose metadata (RFC 8414) names the endpoints. It
answers data, not a flow (and, asking a server, is not run as a test):

```ts ignore
import { discover } from '@yaks/mcp-client/oauth'

const { integration, register } = await discover('https://example.com/mcp')
// integration: { name, authorize, token, scopes?, resource, issuer?, hosts }
const client = await register('http://127.0.0.1:8765/oauth/callback')
```

`integration` is an integration as [@yaks/connections](../connections) takes it:
the grant is for the server (RFC 8707 `resource`), the server's host is the only
one its tokens go to, and a server that says it names its issuer on a return
(RFC 9207) has every return checked for it. `register(redirect)` registers a
public client there (RFC 7591) and answers its id. Signing in, keeping the
tokens and refreshing them is @yaks/connections' and @yaks/oauth's.

Discovery and registration use bounded deadlines, refuse redirects, and require
HTTPS except on loopback addresses. Configure only trusted MCP servers.

## Graph server definitions

`@yaks/mcp-client/graph` is an optional adapter. It exports `serverOf` and
`graphToolName`; the `mcp_server` component is `mcpDoc`, from
`@yaks/mcp-client/vocab`.

```ts
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { mcpDoc } from '@yaks/mcp-client/vocab'

let vocab = loadVocab([mcpDoc])
let g = graph({ storage: ram(vocab), vocab })
await g.apply([{
  entity: { eid: '$server' },
  mcp_server: { name: 'Example', url: 'https://example.org/mcp' },
}])
```

`serverOf(bundle)` validates an enabled `mcp_server` component and returns its
label, entity ID, and portable `Server` configuration. The `$server` alias asks
the graph to generate a UUID. `enabled: false` disables the definition. `allow`
contains JSON text for an array of exact remote names. OAuth fields are
`redirect_url`, `client_id`, `client_metadata_url`, and `scope`.

`graphToolName` creates the displayed tool name, which is also the tool's
identity in a graph: a `tool` entity's id is derived from its name. Renaming the
label changes future exposed tool names.

Low-level `connect` and `clients` work without a graph. Consumer adapters may
validate tool input. The MCP SDK's output validation uses the shared
`@yaks/vocab/tools` validator. Draft-07, 2019-09, and 2020-12 are supported;
undeclared schemas default to 2020-12. Unsupported dialects fail explicitly, and
external schema references are not fetched.
