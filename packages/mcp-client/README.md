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
- `@yaks/mcp-client/oauth`: browser-based OAuth authorization.
- `@yaks/mcp-client/host`: a local JSON-file OAuth store for Deno applications.
- `@yaks/mcp-client/graph`: optional graph-backed server configuration.
- `@yaks/mcp-client/vocab`: the graph vocabulary document alone.

```ts
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

A CLI can add explicit noun and verb metadata:

```ts
const tools = (await remote.tools()).map((tool) => ({
  ...tool,
  noun: 'mockup',
  verb: 'publish',
}))
```

Choose a unique pair for every tool. The `@yaks/cli/structured` adapter can
execute `tool.run(args, context)`; the definitions remain usable by adapters
that do not use CLI names.

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

## Browser authorization with a pasted return URL

`@yaks/mcp-client/oauth` exports `authorization(options)`. It uses MCP SDK
discovery, dynamic client registration, PKCE, token exchange, and refresh. A
pre-registered public `clientId` or `clientMetadataUrl` can replace dynamic
registration.

```ts
import { authorization } from '@yaks/mcp-client/oauth'
import { fileAuthorizationStore } from '@yaks/mcp-client/host'

const login = authorization({
  serverUrl: 'https://example.com/mcp',
  store: fileAuthorizationStore('/home/me/.yaks/mcp-auth.json'),
})
const { url } = await login.begin()
displayPrivately(url) // application UI; do not put this in an agent conversation
await login.complete(returnUrl) // complete URL pasted through private input
const token = await login.token()
```

The default redirect is `http://127.0.0.1:8765/oauth/callback`. The flow starts
no listener. After consent, the browser may show a connection error; the user
copies the complete address-bar URL into a private application input. Configure
`redirectUrl` when the server requires another registered address. An
application may instead supply a loopback listener or hosted callback page. This
is an authorization-code flow, not the deprecated out-of-band grant.

The pending state and PKCE verifier remain in memory and expire after ten
minutes. Restarting or cancelling requires a new authorization. The callback
origin, path, state, and supported issuer parameter are validated before code
exchange. Failed exchanges are not replayed. Tokens refresh shortly before a
known expiry; failed refresh requires sign-in again. Early server revocation may
produce an error, and mutations are not retried with another credential.

`AuthorizationStore` defines `read` and serialized `update` operations.
`fileAuthorizationStore(path)` stores a versioned JSON document with private
file permissions, cross-process advisory locking, and atomic replacement. The
file is not encrypted. Tokens and expiry stay in that private record; no OAuth
graph vocabulary is introduced. Applications can implement the interface with a
secret store. Access tokens belong only in trusted request code.

Configure only trusted MCP servers. OAuth discovery and token requests use
bounded deadlines, refuse redirects, and require HTTPS except on loopback
addresses. This module is not a general SSRF sandbox or provider-independent
OAuth package.

## Graph server definitions

`@yaks/mcp-client/graph` is an optional adapter. It exports `mcpDoc`,
`serverOf`, and `graphToolName`. Connections and credentials remain outside
graph storage.

```ts
await graph.apply([{
  entity: { eid: '$server' },
  mcp_server: { name: 'Example', url: 'https://example.org/mcp' },
}])
```

`serverOf(bundle)` validates an enabled `mcp_server` component and returns its
label, entity ID, and portable `Server` configuration. The `$server` alias asks
the graph to generate a UUID. `enabled: false` disables the definition. `allow`
contains JSON text for an array of exact remote names. OAuth fields are
`redirect_url`, `client_id`, `client_metadata_url`, and `scope`. `credential` is
an application-defined reference, never a bearer token.

`graphToolName` creates the displayed tool name, which is also the tool's
identity in a graph: a `tool` entity's id is derived from its name. Renaming the
label changes future exposed tool names.

Low-level `connect` and `clients` work without a graph. Consumer adapters may
validate tool input. The MCP SDK's output validation uses the shared
`@yaks/vocab/tools` validator. Draft-07, 2019-09, and 2020-12 are supported;
undeclared schemas default to 2020-12. Unsupported dialects fail explicitly, and
external schema references are not fetched.
