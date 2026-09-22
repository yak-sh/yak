# @yaks/mcp

Expose a [@yaks/graph](../graph/README.md) graph as a Model Context Protocol
(MCP) server. Agents can query and change graph data through generic tools and
tools provided by graph plugins. Use `mcp()` for an HTTP request handler or
`@yaks/mcp/stdio` for a server launched as a local process.

A **bundle** is one entity's components as a JSON object, identified by
`entity.eid`. A **batch** is a list of changes applied in one transaction. MCP
arguments are JSON objects; graph data and tool results use bundles.

## Install

```sh
deno add jsr:@yaks/mcp
# or: npx jsr add @yaks/mcp
```

## Use

The application supplies an initialized graph and, optionally, authentication:

```ts
import { mcp } from '@yaks/mcp'
import { authenticate, graph } from './shop.ts'

let handler = mcp({ graph, authenticate })
Deno.serve(handler)
```

The graph used to record calls must declare the components in `toolsDoc` from
`@yaks/tools`. For example, this complete in-memory setup serves a graph with
one application component:

```ts
import { graph } from '@yaks/graph'
import { mcp } from '@yaks/mcp'
import { ram } from '@yaks/ram'
import { toolsDoc } from '@yaks/tools'
import { loadVocab } from '@yaks/vocab'

let vocab = loadVocab([toolsDoc, {
  $defs: {
    book: {
      component: true,
      type: 'object',
      properties: {
        title: { type: 'string' },
        price: { type: 'number' },
        status: { enum: ['shelved', 'sold'] },
      },
    },
  },
}])
let shop = graph({ vocab, storage: ram(vocab) })
Deno.serve({ port: 8000 }, mcp({ graph: shop }))
```

This example permits unauthenticated access and loses its data when the process
exits. Choose a persistent storage adapter and an authentication policy for an
application that needs them.

The HTTP handler answers every request passed to it; it does not select a path.
To mount it beside the graph's HTTP API:

```ts
import { api } from '@yaks/api'
import { mcp } from '@yaks/mcp'
import { authenticate, graph } from './shop.ts'

let http = api({ graph, authenticate })
let agents = mcp({ graph, authenticate })
Deno.serve((request) =>
  new URL(request.url).pathname == '/mcp' ? agents(request) : http(request)
)
```

## The plugin: `/mcp` as a route

`@yaks/mcp/routes` is the same handler as one `Route` at `/mcp`, so a host
composed from a config gets it by listing this package
([@yaks/cli](../cli/README.md)). Whatever serves that host's routes serves this
one — [@yaks/api](../api/README.md) does — and a config listing neither runs the
same tools in its own process with nothing listening.

The generic tier is restated for this transport (`core: true`), which is what
gives `graph_apply` the bundle schema the host's own vocabulary describes. The
host's copies of that tier (@yaks/graph `tier`, the form a command line reads)
are dropped from the list the route is handed, so each generic tool is listed
once.

## Storage

This package does not create its own database. `tools/call` uses the
[@yaks/tools](../tools/README.md) runner to record a `call` entity before
execution and a `result` entity afterwards. The runner also registers tool
entities. These records use `graph` by default, including for read tools. Pass
`calls: anotherGraph` to keep call records in a separate graph; application
reads and writes still use `graph`. The calls graph needs the `toolsDoc`
vocabulary and writable storage.

The HTTP handler shares one runner across requests and constructs an MCP server
with the authenticated actor for each request. HTTP protocol state is not
retained between requests.

## Exports

| Import            | Exports and purpose                                                                                                                                 |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@yaks/mcp`       | `mcp`, `MountOptions`, `Handler`: HTTP handler and its types                                                                                        |
| `@yaks/mcp`       | `server`, `Options`: SDK server for a caller-supplied transport                                                                                     |
| `@yaks/mcp`       | `core`, `CoreOpts`, `Search`, `Guide`: generic tool construction and callbacks                                                                      |
| `@yaks/mcp`       | `bundleSchema`, `schemaSchema`, `BundleOpts`, `Depth`: Zod schemas for bundles and schema results                                                   |
| `@yaks/mcp`       | `listing`, `roster`, `rosterVersion`, `rosterLine`: tool definitions, names, and change notices                                                     |
| `@yaks/mcp`       | `shapeOf`, `inputSchemaOf`, `annotated`, `COMMAND`, `Security`: argument schemas, MCP annotations, command metadata key, and security metadata type |
| `@yaks/mcp/stdio` | `stdio`: connect the server to process stdin and stdout                                                                                             |

`annotated(tool)` produces MCP behavior hints and includes `annotations.title`
when the tool declares a nonempty title. It does not invent a title for tools
without one.

## The five graph tools

The generic tools are declared and implemented in `@yaks/graph`. `core()` adapts
their input schemas to the graph vocabulary and this server's options. Four
tools are listed by default; `search` requires a callback.

| Tool           | Purpose                                                         |
| -------------- | --------------------------------------------------------------- |
| `graph_apply`  | Apply changes and return their applied bundles                  |
| `graph_query`  | Read entities selected by a query                               |
| `graph_show`   | Read named entities and, by default, entities referencing them  |
| `graph_schema` | Describe components, columns, and kinds                         |
| `search`       | Return ranked text matches using the supplied `search` callback |

For the vocabulary in the in-memory example:

```jsonc
// graph_apply
{ "change": [
  { "entity": { "eid": "b1" },
    "book": { "title": "Dune", "price": 12, "status": "shelved" } }
] }

// graph_query
{ "q": ".status=shelved&.price<20" }

// graph_show
{ "ids": ["b1"], "backrefs": false }

// graph_schema
{}
{ "component": "book" }
```

`graph_apply` accepts `check: true` to test changes and roll them back; the
proposed applied result is returned as JSON text in a result bundle. Call
records are still written. A later application can fail even if the check
succeeded.

`graph_query` accepts a query defined by [@yaks/query](../query/README.md),
optional `filters` joined with `&`, and a `limit`. `graph_show` returns entity
bundles; references remain in their component columns, and edge entities are
ordinary bundles. `backrefs: false` omits entities that reference the requested
ones.

With no arguments, `graph_schema` returns the component index with descriptions
and column names. `component` selects one or more full component descriptions,
including column types, server-owned fields, uniqueness, byte storage,
references, and example bundles. `kind` describes a declared kind and its
components. An application-supplied `guide` callback can add documentation
links.

## What a call returns

Successful calls return the same answer in two forms:

- `content`: a text block containing the text from result bundles, or their JSON
  when they do not contain text.
- `structuredContent: { result: Bundle[] }`: the result bundles themselves.

There is no separate `{ bundles: … }` wrapper for `graph_show`. No tool output
schema is advertised. Values that are not existing entities, such as
`graph_schema`'s answer, are represented by a bundle with JSON text in
`content.body` and the originating call ID in `output.source`.

A recorded failure carries an `error` or `exception` component and sets
`isError`. Errors caught before a recorded answer is available can return only
error text and `isError`, without `structuredContent`.

`graph_apply`'s input schema is generated from the current vocabulary. Other
tools also declare their argument schemas. To generate a bundle schema yourself:

```ts
import { bundleSchema } from '@yaks/mcp'

let schema = bundleSchema(vocab, { depth: 'full' })
```

## The schema describes, the server decides

Bundle input schemas describe declared components and columns but allow unknown
properties through to the graph. This lets a client with a cached tool schema
submit a column added since it connected. The graph remains responsible for
rejecting undeclared columns. Such errors point callers to `graph_schema`, which
reads the current vocabulary.

## A tool list goes stale

Clients may cache tool lists. `roster(opts)` returns the names a server lists;
`rosterVersion(names, release)` hashes those names and an optional release ID.
`rosterLine(previousNames, currentNames)` returns a notice naming added and
removed tools, or `undefined` when the names are unchanged.

Pass a `roster` callback to append a notice as a separate text block after a
tool result. The application must track each client's previous list and update
it when a notice is sent; this stateless HTTP handler does not maintain
sessions. A release change without a tool-name change changes the version but
produces no notice.

New components automatically appear in `graph_schema` and newly generated write
schemas. A new component therefore does not require a new tool.

## Authentication and write attribution

`mcp({ authenticate })` calls `authenticate(request)` for each POST request. Its
actor, such as `{ by: memberId, via: sessionId }`, determines attribution for
the call and the changes returned by its tool. Client-supplied `$actor` values
do not override it. Return `null` for unattributed requests or throw
`Unauthorized` from `@yaks/api` for HTTP 401. The application and graph plugins
supply authorization; authentication and tool metadata do not enforce access
policy by themselves.

`readOnly: true` removes `graph_apply` from the generic tool list. It does not
remove plugin or explicitly supplied tools, prevent them from writing, or
disable call recording. Review those tools when configuring a read-only
endpoint.

`scope` adds Zod arguments to generic read tools, for example a tenant name. The
generic implementations ignore these arguments. Application routing must inspect
and validate them and select the graph before passing the request to this
handler. `scope` alone does not implement tenant selection or isolation.

## Plugins bring tools

A graph plugin can contribute tools, and `Options.tools` adds tools directly.
The list is ordered: generic tools, plugin tools, then explicitly supplied
tools. Set `core: false` when the application already supplies the generic
tools.

```ts
import type { Plugin } from '@yaks/graph'
import { z } from 'zod'

let shelf: Plugin = {
  name: 'shelf',
  tools: [{
    name: 'shelve',
    description: 'Set a book status to shelved.',
    input: { book: z.string().describe('Book entity ID') },
    run: (_, ctx) => [{
      entity: { eid: String(ctx.args.book) },
      book: { status: 'shelved' },
    }],
  }],
}

graph.use(shelf)
```

A tool receives the call bundle and a `ToolCtx` containing the graph, actor,
validated arguments, and call ID. It returns bundles. The runner applies changes
as the caller and records the result. Read tools return selected bundles without
rewriting those entities. A text result uses `content: { body: '…' }` and
`output: { source: ctx.call }` on its bundle.

Tool `meta` is sent as MCP `_meta`; the adapter also adds declared command
metadata under `COMMAND` (`yaks.sh/command`). The `security` option supplies
advertised security schemes globally or per tool, unless the tool defines its
own. These schemes describe authentication to clients; the application enforces
it.

## When a server offers more than tools

The HTTP and stdio entrypoints await `extend(server)` after registering tools.
Use it to register SDK resources or prompts:

```ts
mcp({
  graph,
  extend: (server) => {
    server.registerResource('guide', 'shop://guide', {
      mimeType: 'text/markdown',
    }, () => ({
      contents: [{
        uri: 'shop://guide',
        text: 'Use graph_schema to inspect books.',
      }],
    }))
  },
})
```

When calling the lower-level `server(opts)` directly, invoke `opts.extend`
yourself before connecting the transport; `server()` does not call it.

## Refusals

Bad tool arguments and rejected changes return tool error text with `isError`.
HTTP transport responses include 405 for methods other than POST, 400 for
malformed JSON or anything other than one JSON-RPC request or notification, 401
for `Unauthorized`, and 202 for notifications. Request arrays are rejected.
Other thrown errors use [@yaks/api](../api/README.md#refusals)'s status mapping.

The HTTP transport has no SSE stream. Its request timeout defaults to 60,000 ms
and can be configured with `timeout`.

## stdio

For an agent that launches the server as a local process:

```ts
// deno run -A serve.ts
import { stdio } from '@yaks/mcp/stdio'
import { graph } from './shop.ts'

await stdio({ graph, actor: { by: 'm1' } })
```

The caller supplies the actor because there is no HTTP request to authenticate.
The module uses process streams and is kept separate from the portable HTTP
entrypoint.

## JSON Schema tool declarations

Tools may declare `noun`/`verb` and a complete `inputSchema` instead of a name
and a per-argument Zod `input` object. A noun/verb pair becomes an MCP name such
as `session_list`; a single noun or verb retains that word. JSON Schema
arguments are validated through `@yaks/vocab/tools` before `run`. Zod
declarations use Zod validation. Security callbacks receive normalized tool
names.

When any tool supplies JSON Schema, the adapter provides its own `tools/list`
response to preserve that schema. The response captures the initial tool
registry; adding, disabling, or modifying SDK tools after server construction is
not supported in this mode. Resources and prompts can still be added with
`extend`.

## Compatibility

The main module supports fetch-style HTTP handling in Deno, Node, Bun, and
Cloudflare Workers. `@yaks/mcp/stdio` requires process streams, so it is
intended for Deno, Node, and Bun. Dependencies include sibling graph, API,
vocabulary, and tool-runner packages, the MCP SDK, Zod, and
`zod-to-json-schema`.

## The family

[@yaks/graph](../graph/README.md) defines graph operations and generic tools;
[@yaks/tools](../tools/README.md) executes and records calls;
[@yaks/vocab](../vocab/README.md) describes components; and
[@yaks/api](../api/README.md) provides direct HTTP and WebSocket access.
[@yaks/fts](../fts/README.md) adds text matching to graph queries when composed
with storage; ranked `search` still requires a callback.

## License

Apache-2.0
