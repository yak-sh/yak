# @yaks/mcp

Expose a [@yaks/graph](../graph/README.md) graph as a Model Context Protocol
(MCP) server. Agents can query and change graph data through generic tools and
tools provided by graph plugins. Use `mcp()` for an HTTP request handler or
`@yaks/mcp/stdio` for a server launched as a local process.

A **bundle** is one entity's components as a JSON object, identified by
`entity.eid`. A **batch** is a list of bundles applied in one transaction. MCP
arguments are JSON objects; graph data and tool results use bundles.

## Install

```sh
deno add jsr:@yaks/mcp
# or: npx jsr add @yaks/mcp
```

## Use

The application supplies an initialized graph and, optionally, authentication:

```ts ignore
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
        status: { type: 'string', enum: ['shelved', 'sold'] },
      },
    },
  },
}])
let shop = graph({ vocab, storage: ram(vocab) })
if (import.meta.main) Deno.serve({ port: 8000 }, mcp({ graph: shop }))
```

This example permits unauthenticated access and loses its data when the process
exits. Choose a persistent storage adapter and an authentication policy for an
application that needs them.

The HTTP handler answers every request passed to it; it does not select a path.
To mount it beside the graph's HTTP API:

```ts ignore
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

The generic tier is restated for this transport (`core: true`), which adds what
only a server knows: the search it ranks with. The host's copies of that tier
(@yaks/graph `tier`, the form a command line reads) are dropped from the list
the route is handed, so each generic tool is listed once.

## Storage

This package does not create its own database. `tools/call` uses the
[@yaks/tools](../tools/README.md) runner to record a `call` entity before
execution and a `result` entity afterwards. The runner also registers tool
entities. These records use `graph` by default, including for read tools. Pass
`calls: anotherGraph` to keep call records in a separate graph; application
reads and writes still use `graph`. The calls graph needs the `toolsDoc`
vocabulary and writable storage.

Pass `reply` (@yaks/tools `Reply`) for what a direct call is owed beside its
answer; the `@yaks/mcp/routes` host route passes its host's, so a caller over
MCP reads what one at the command line reads.

The HTTP handler shares one runner across requests and constructs an MCP server
with the authenticated actor for each request. Pass `sessions: graph` when that
graph owns connection transcripts and declares the session vocabulary. A legacy
request without `x-via` then gets an `Mcp-Session-Id` response header; the
caller sends it on later requests, and the graph preserves attribution across
restarts. A caller supplying `x-via` continues to speak for the session it
named. The `@yaks/mcp/routes` host route supplies its graph when that host
loaded the session vocabulary.

A calling application that owns its own MCP session protocol can leave
`sessions` unset. The yaks.app connector does this today: it uses
`Mcp-Session-Id` for streams and cached tool rosters, while its tools span app
stores and no graph owns a connector transcript. The mount leaves that
application's header and storage alone.

The route composes the generic graph vocabulary's top-level `instructions` with
each loaded vocabulary document's instructions in document order and sends them
in the MCP `initialize` response. Other plugins can add instructions beside
their own component declarations.

`instructions` may also be a function returning the text. It is called only for
the exchange that sends it, `initialize` (or for a stdio connection), so a host
whose instructions cost reads pays them once per connection, not on every call.
`instructed(opts, exchange)` answers what a server for that exchange sends:

```ts
import { instructed } from '@yaks/mcp'
import { equal } from '@yaks/testing'

let asked = 0
let opts = { instructions: () => `asked ${++asked}` }
equal(await instructed(opts, { method: 'tools/call' }), undefined)
equal(await instructed(opts, { method: 'initialize' }), 'asked 1')
equal(asked, 1)
```

## Exports

| Import             | Exports and purpose                                                                                                                                 |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@yaks/mcp`        | `mcp`, `MountOptions`, `Handler`: HTTP handler and its types                                                                                        |
| `@yaks/mcp`        | `server`, `Options`, `instructed`: SDK server for a caller-supplied transport, and the instructions an exchange sends                               |
| `@yaks/mcp`        | `core`, `CoreOpts`, `Search`, `Guide`: generic tool construction and callbacks                                                                      |
| `@yaks/mcp`        | `listing`, `roster`, `rosterVersion`, `rosterLine`: tool definitions, names, and change notices                                                     |
| `@yaks/mcp`        | `shapeOf`, `inputSchemaOf`, `annotated`, `COMMAND`, `Security`: argument schemas, MCP annotations, command metadata key, and security metadata type |
| `@yaks/mcp/tools`  | `core`, `shapeOf`, `inputSchemaOf`, `translated`: the generic tier, argument schemas and former argument names without the MCP SDK                  |
| `@yaks/mcp/skills` | `attachSkills`: scoped prompts, resources and complete Skills manifests                                                                             |
| `@yaks/mcp/stdio`  | `stdio`: connect the server to process stdin and stdout                                                                                             |

The schema helpers are owned by `@yaks/tools/schema`; MCP re-exports them for
callers using these imports. `Options.registry` supplies a shared provider
catalog, or `Options.runner` supplies its runner and catalog together. Listings
and calls follow provider replacement. An admitted call retains its tool while
its registration and execution are awaited.

`annotated(tool)` produces MCP behavior hints and includes `annotations.title`
when the tool declares a nonempty title. It does not invent a title for tools
without one.

## The five graph tools

The generic tools are declared and implemented in `@yaks/graph`. `core()` adapts
their input schemas to the graph vocabulary and this server's options. Four
tools are listed by default; `search` requires a callback.

| Tool           | Purpose                                                         |
| -------------- | --------------------------------------------------------------- |
| `graph_apply`  | Apply bundles and return their applied bundles                  |
| `graph_query`  | Read entities selected by a query                               |
| `graph_show`   | Read named entities, each whole                                 |
| `graph_schema` | Describe components, properties, and kinds                      |
| `search`       | Return ranked text matches using the supplied `search` callback |

For the vocabulary in the in-memory example:

```jsonc
// graph_apply
{ "bundles": [
  { "entity": { "eid": "b1" },
    "book": { "title": "Dune", "price": 12, "status": "shelved" } }
] }

// graph_query
{ "q": ".book.status=shelved&.book.price<20" }

// graph_show
{ "ids": ["b1"] }

// graph_schema
{}
{ "component": "book" }
```

`graph_apply` accepts `check: true` to test a batch and roll it back; the answer
is what a kept write would have returned, or the refusal it would have met. Call
records are still written. A later application can fail even if the check
succeeded.

`graph_query` accepts a query defined by [@yaks/query](../query/README.md),
optional `filters` joined with `&`, and a `limit`. `graph_show` returns the
entities asked for and nothing else; references remain in their component
properties, and what references an entity is a query of its own (`.refs=<id>`),
where edge entities are ordinary bundles. An id that names nothing is said after
the rest, in a line naming it, so one miscopied id does not cost the others; a
call whose ids all name nothing is refused.

`graph_schema` answers markdown to read and, as `structuredContent`, one JSON
Schema document with each component's entry under `$defs`, the shape of a
vocab.json. With no arguments it is the index: every component's description,
whether it names a kind, and each property's type. `component` selects one or
more components as declared, each with an example value: a name, an array of
names, or one string of names set apart by spaces or commas. The markdown adds
what references it and an example bundle. A name nobody declared is refused,
every such name said at once. `kind` is a declared kind in full beside the index
entries of the components it is shown with. An application-supplied `guide`
callback adds documentation links to the markdown.

## What a call returns

Successful calls return the same answer in two forms:

- `content`: a text block containing the text from result bundles, or their JSON
  when they do not contain text.
- `structuredContent: { result: Bundle[] }`: the result bundles themselves.

There is no separate `{ bundles: … }` wrapper for `graph_show`. Every tool
advertises the same `outputSchema` for that answer (`answerSchema` from
`@yaks/tools/schema`): an object with `result`, an array of bundles, each
carrying `entity.eid` and any component beside it. It is generic rather than
derived from the vocabulary, because a typed bundle repeated per tool would be
most of a `tools/list`. A tool whose answer is not entities declares its own
`outputSchema` and answers one bundle: its text in `content.body`, and the value
in that shape in `output.value`, which is what `structuredContent` carries.
`graph_schema` is that tool, and its output schema is the vocab meta-schema.

Every key on a bundle beside `entity` and the `$` sugars is read as a component,
an object or null. A host whose rows carry words of their own beside their
components passes `answer: answerWith({kind: {type: 'string'}})`, and every tool
whose answer is entities is listed with that schema instead. A client refuses an
answer that does not fit what its tool is listed with, after the server has
answered, so the server checks each answer against the same schema as it leaves
and passes one that does not fit to `report`; the answer is still sent.

A recorded failure carries a `refusal` or `exception` component and sets
`isError`. Errors caught before a recorded answer is available can return only
error text and `isError`, without `structuredContent`.

## The schema describes, the server decides

`graph_apply`'s input schema is the generic bundle: an array of objects, each
with `entity: {eid}` and open components. It is the same over every vocabulary,
so the tool list costs the same whatever a store declares, and a client that
cached it never holds a stale copy of the vocabulary. `graph_schema` reads the
components and properties this graph declares. The graph refuses an undeclared
component or property and a value of the wrong type, and its refusal points the
caller to `graph_schema`.

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

A renamed argument keeps answering under its former name: every call is put
through `translated(tool, args)` before it is recorded or checked, so a client
whose list predates the rename is answered and the tool sees one shape. Where a
caller sends both names, the current one wins.

```ts
import { assertEquals } from '@std/assert'
import { translated } from '@yaks/mcp/tools'

assertEquals(translated('graph_apply', { change: [] }), { bundles: [] })
```

New components automatically appear in `graph_schema`, and `graph_apply` writes
them. A new component therefore does not require a new tool.

## Authentication and write attribution

`mcp({ authenticate })` calls `authenticate(request)` for each POST request. Its
actor, such as `{ by: memberId, via: sessionId }`, determines attribution for
the call and the bundles returned by its tool. Client-supplied `$actor` values
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
tools. A tool whose `surfaces` leaves out `mcp`, such as `serve`, is neither
listed nor callable here.

```ts ignore
import { argsOf, type Plugin } from '@yaks/graph'
import { z } from 'zod'

let shelf: Plugin = {
  name: 'shelf',
  tools: [{
    name: 'shelve',
    description: 'Set a book status to shelved.',
    input: { book: z.string().describe('Book entity ID') },
    run: (call) => [{
      entity: { eid: String(argsOf(call).book) },
      book: { status: 'shelved' },
    }],
  }],
}

graph.use(shelf)
```

A tool is `run(call, graph)`: the call's bundle, carrying its validated
arguments in `call.args` (`argsOf`) and the caller in `created` (`who`), and the
graph it runs on. It returns bundles. The runner applies bundles as the caller
and records the result. Read tools return selected bundles without rewriting
those entities. A text result uses `content: { body: '…' }` and
`output: { source: call.entity.eid }` on its bundle.

Tool `meta` is sent as MCP `_meta`; the adapter also adds declared command
metadata under `COMMAND` (`yak.sh/command`). The `security` option supplies
advertised security schemes globally or per tool, unless the tool defines its
own. These schemes describe authentication to clients; the application enforces
it.

## When a server offers more than tools

The HTTP and stdio entrypoints await `extend(server, exchange)` and then
`skills(server, exchange)` after registering tools. HTTP passes the method of
that one exchange; stdio leaves it undefined for the connection. A host can
leave out what that exchange never reads: a `tools/call` lists no resource or
prompt. Use it to register SDK resources or prompts:

```ts ignore
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

Bad tool arguments and rejected batches return tool error text with `isError`.
Legacy HTTP transport responses include 405 for methods other than POST, 400 for
malformed JSON or anything other than one JSON-RPC request or notification, 401
for `Unauthorized`, and 202 for notifications. Request arrays are rejected.
Other thrown errors use [@yaks/api](../api/README.md#refusals)'s status mapping:
a refusal is answered with its status, and a failure (500) is thrown on to the
host, whose watch answers and reports it (@yaks/api `served`). On the modern leg
the SDK answers its own refusals and failures, and each one goes to the `report`
option with no call.

The legacy transport has no SSE stream. It waits for each call's outcome by
default. A host can set `timeout` to limit how long it waits for a legacy reply;
timing out does not cancel a tool already running. `clock` (an @yaks/fp `Clock`,
by default the runtime's) keeps that timeout and the handler's runner's time.
Modern traffic uses the SDK HTTP entry and its protocol validation and
streaming.

## Repository skills

The box route offers the checkout's skills without copying them into another
store. Discovery exposes descriptions; prompts load instructions explicitly. The
same snapshot supplies prompts, resources and the MCP Skills extension.

```ts ignore
import { attachSkills } from '@yaks/mcp/skills'

let agents = mcp({
  graph,
  authenticate,
  skills: (built, exchange) =>
    attachSkills(built, { graph, cwd: checkout }, exchange),
})
```

Supply an explicit repository id for graph-backed skills, or a `cwd` for a
read-only checkout view. No scope means no skills: it never exposes every
repository in a shared graph. The box's `/mcp` facet uses its process checkout.
Local changes and deletions are reflected on the next consuming request, without
graph imports. Tool-only HTTP exchanges do not snapshot skills; discovery,
resources and prompts each retain their fresh immutable snapshot. Graph-backed
documents are rendered by the shared persona codec.

A host with another file store can supply a callback instead of graph/checkout
options. It returns `{ scope, files }`, where `files` maps repository-relative
paths to byte arrays. Each consuming exchange reads the callback and copies its
bytes into its snapshot; tool exchanges do not call it.

The Skills extension advertises `resources` and
`io.modelcontextprotocol/skills`. `skills/list` and `skills/get` return complete
manifests with the document and supporting files, exact SHA-256 byte digests and
sizes. Resource reads serve those same bytes. This includes nested and binary
companions in a checkout. Unknown skill URIs are refused; unsafe trees and
nonconforming Agent Skills metadata are refused rather than silently renamed or
partially published. Snapshot cache hints are private with zero TTL. No
`resources/directory/read` capability is advertised.

Prompts and resources provide explicit compatibility for clients that do not
implement the extension. Reading a resource does not activate a skill, and we
have not verified automatic description-based activation in Claude over MCP.

## Protocol revisions

The SDK v2 factory entry serves modern `2026-07-28` traffic. Requests without a
modern envelope retain the existing legacy HTTP mount and graph-session
semantics. Both legs authenticate through the host before building a server;
modern traffic creates no MCP graph session or client-info identity. The host's
security filters still surround the route; the SDK is not token authorization or
Origin/Host validation.

Tool schemas remain exact advertisements. Calls still go through the shared
graph runner, including malformed arguments, so validation refusals,
attribution, call records, roster notices and structured results remain
runner-owned. Connecting a lower-level SDK server directly is legacy-only; use
`mcp()` for modern HTTP and `stdio()` for era-selecting process streams.

## stdio

For an agent that launches the server as a local process:

```ts ignore
// deno run -A serve.ts
import { stdio } from '@yaks/mcp/stdio'
import { graph } from './shop.ts'

stdio({ graph, actor: { by: 'm1' } })
```

It serves until the client closes the stream, or until `close()` on the handle
it returns. The caller supplies the actor because there is no HTTP request to
authenticate. A second argument, a transport, serves that connection instead of
the process's own streams. The module uses process streams and is kept separate
from the portable HTTP entrypoint.

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
