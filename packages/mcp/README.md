# @yaks/mcp

The [Model Context Protocol](https://modelcontextprotocol.io) server for a
[@yaks/graph](https://jsr.io/@yaks/graph), written as a plain request handler
that runs in any JavaScript runtime.

Point it at a graph and an agent can read and write it — over Streamable HTTP
beside your other routes, or over stdio for a server the agent launches itself.

## Install

```sh
deno add jsr:@yaks/mcp
# or: npx jsr add @yaks/mcp
```

## Use

```ts
import { mcp } from '@yaks/mcp'

let handler = mcp({ graph, authenticate })

Deno.serve((request) => handler(request)) // …or any fetch-style runtime
```

The handler answers **every** request it is given, so mount it on whatever path
you like — beside [@yaks/api](https://jsr.io/@yaks/api)'s routes, say:

```ts
let http = api({ graph, authenticate })
let agents = mcp({ graph, authenticate })

Deno.serve((request) =>
  new URL(request.url).pathname == '/mcp' ? agents(request) : http(request)
)
```

These fragments assume a graph and an `authenticate` callback your application
supplies. The data examples use a bookshop: books with a price and a status,
reviews about them, and members who buy them.

## The five graph tools

Every tool here accepts and returns bundles: objects made of `entity: {eid}` and
component objects. The graph's vocabulary decides which components, columns and
types are accepted. There is no separate tool per application component.

All five are declared in [@yaks/graph](https://jsr.io/@yaks/graph)'s own
`vocab.json` — `graph apply`, `graph query`, `graph show`, `graph schema` and
`search`, written as two words on a command line and as `graph_apply` and the
rest when a client lists them — and implemented in `@yaks/graph/tools`. `core`
here shapes them for one server: the vocabulary fills in which bundles
`graph_apply` accepts, `readOnly` leaves the write tool unlisted, and `scope`
adds a server's own arguments to every read.

| tool           | what it does                                                       |
| -------------- | ------------------------------------------------------------------ |
| `graph_apply`  | bundles in, the transaction as applied out — one bundle per entity |
| `graph_query`  | a query string in, bundles out                                     |
| `graph_show`   | whole entities, with everything that references them, as bundles   |
| `graph_schema` | the component index, or one component's full schema                |
| `search`       | ranked text results — needs a `search` callback                    |

```jsonc
// graph_apply
{ "change": [
  { "entity": { "eid": "b1" },
    "doc":  { "title": "The Left Hand of Spring" },
    "book": { "price": 12, "status": "shelved" } }
] }

// graph_query
{ "q": ".status=shelved&.price<20" }

// graph_show
{ "ids": ["b1"] }
// → { bundles: [the book, and each review of it] }

// graph_schema — no argument, one component, or a kind
{}                      // the index: every component, its line, its columns
{ "component": "book" } // that one in full: types, meaning, references, example
{ "kind": "book" }      // what an entity of that kind is made of
```

`graph_show` returns `{bundles}` and nothing else. References stay in the
bundles’ own columns; edge entities are ordinary bundles, not a separate list.
Set `backrefs: false` to return only the entities named.

`graph_query` takes the query string [@yaks/query](https://jsr.io/@yaks/query)
defines, plus an optional `filters` array joined onto it with `&` — one thin
layer over the same grammar, not a second grammar.

An agent that has never seen your vocabulary calls `graph_schema` first. With no
argument it returns the INDEX — every component, the one-line description its
schema gives it, and its column names — small enough to read whole. Given a
component name it returns that component in full: each column's type and
description, which columns are server-owned or unique or stored as bytes, what
references it and what it references, an example bundle that writes it, and the
page your application documents it on (`guide`). It rarely has to ask at all:
`graph_apply`'s own input schema is derived from that vocabulary, fully typed,
so the write tool teaches itself.

## What a call returns

A reply carries the result twice: the text its bundles hold, and the bundles
themselves as `structuredContent` under `result`. No tool declares an output
schema — the vocabulary already describes what a bundle is, and a second
description of it is context an agent pays for before it has asked anything.

A result that is not entities comes back as the one entity it can be: text, as
`content{body}`, recording which call produced it (`output{source}`). That is
how `graph_schema` returns its answer — a vocabulary is not rows in the store it
describes.

`graph_apply`'s input is the one schema this server publishes, and it is derived
from your vocabulary, so a component you add appears in it with nobody editing
anything. The derivation is exported, so you can build the same schema for a
handler of your own:

```ts
import { bundleSchema } from '@yaks/mcp'

let bundle = bundleSchema(shop, { depth: 'full' })
```

## The schema describes, the server decides

A client lists the tools once, at `initialize`, and holds that list — schemas
included — for the whole conversation, while your vocabulary keeps growing
underneath it. So the write schema is **open**: every declared column is typed,
named and described, and an undeclared one is not refused there. A closed schema
would have a client's stale copy refuse a column that now exists, inside the
client, where no server can explain it.

Admission is the authority. A column nobody declared is refused by
[@yaks/graph](https://jsr.io/@yaks/graph), naming the column, naming the columns
the component does declare, and pointing at `graph_schema` — which reports what
this graph declares _right now_.

## A tool list goes stale

The other half of the same problem: a tool a release added is one the agent
cannot see, and a tool that was removed is one it calls into a refusal.
`notifications/tools/list_changed` is the protocol's answer, and a server that
holds a stream should send it. But a client without one hears nothing, so say it
again where the agent is certainly reading — on the next result:

```ts
import { roster, rosterLine, rosterVersion } from '@yaks/mcp'

let version = rosterVersion(roster(opts), release) // name the list you serve
// …remember it per session at initialize, then:
mcp({ ...opts, roster: (names) => rosterLine(cached[session], names) })
```

`roster` is the tool names this server lists; `rosterVersion` hashes them
together with your release id, so it changes when either does; `rosterLine`
writes the notice:

> The tool list changed since you connected (new: mail_list, mail_send; gone:
> vocab). Reconnect to see them, or ask `about`.

It is returned as a trailing content block, so a JSON result stays JSON. Send it
once per changed set — record the new roster when you send it.

**New capability = new component, not a new tool.** The generic tier already
writes anything your vocabulary declares, and a component appears in
`graph_schema` and in the write schema by itself. A tool per feature is a tool
list that changes under every client you have.

## Authentication and write attribution

A bundle can claim anything, including whose name is on it. So a server is built
per request around the identity your `authenticate` returned, and every
transaction a tool applies is signed with that identity — never with what the
client sent:

```ts
let authenticate = (request: Request) => {
  let token = request.headers.get('authorization')
  return token ? { by: memberFor(token) } : null
}
```

Return `null` and writes are stored unattributed; throw `Unauthorized` and the
request is answered with a 401. It is the same `Authenticate` interface
[@yaks/api](https://jsr.io/@yaks/api) takes, and the same signing, so both ways
into one graph agree about who is writing.

Nothing else about a call is trusted either: which columns a caller may write,
whether a precondition still holds, and what a delete takes with it are all
[@yaks/graph](https://jsr.io/@yaks/graph)'s to decide.

For a public read-only endpoint, set `readOnly`: `graph_apply` is then not a
tool that refuses, it is a tool that is not listed. Where such an endpoint
serves a graph it picks per request — one tenant, one app, one shelf — `scope`
declares what to name that graph by, and every read tool accepts those arguments
beside its own:

```ts
let handler = mcp({
  graph: shelfFor(request),
  readOnly: true,
  scope: { shelf: z.string().describe('which shelf') },
})
```

The tools ignore them: the surrounding program read them off the request and
built the graph they name before this server saw it. They are declared so that a
client knows to send them.

## Plugins bring tools

A [@yaks/graph](https://jsr.io/@yaks/graph) plugin contributes tools the same
way it contributes components and hooks:

```ts
let shelf = {
  name: 'shelf',
  tools: [{
    name: 'shelve',
    description: 'put a book on the shelf',
    input: { book: z.string().describe('the book to shelve') },
    run: (_, ctx) => [{
      entity: { eid: String(ctx.args.book) },
      book: { status: 'shelved' },
    }],
  }],
}

graph.use(shelf)
```

They are listed beside the generic tier, with the same signing and the same
reply shape. A tool is a function from BUNDLES to BUNDLES: it is handed the
call's own bundle and a `ToolCtx` — the graph to READ, who is asking, the
arguments the client sent (already validated against its `input`), and the call
being answered. Schemas are [Zod](https://zod.dev), because the MCP SDK takes
Zod.

A tool never writes. The bundles it returns ARE the write: @yaks/tools' runner
applies them signed as the CALLER, in one transaction beside the
`result{call, ms}` entity that records the call. Text a person reads is a bundle
like any other — `content{body}` — never a separate channel beside it.

`tools/call` runs the function, here, for this request. What it records as it
goes is the TRANSCRIPT: a `call{to, args}` entity written before the function
runs, signed as whoever is asking, and the result after. A server whose graph
should not hold that — a connector over somebody else's store — passes a `calls`
graph of its own, and the tools still read and write `graph`.

A tool that carries `meta` has it handed to the client verbatim as `_meta`:

```ts
{
  name: 'shelf',
  description: 'what is on the shelf',
  meta: { ui: { resourceUri: 'ui://shop/shelf' } },
  run: (_, ctx) => [{
    entity: { eid: '$said' },
    content: { body: 'two books here' },
    output: { source: ctx.call },
  }],
}
```

Its text is the reply's text; the bundle that carried it is the reply's
structure.

## When a server offers more than tools

`extend` is handed the SDK's own server object once the tools are registered on
it, so resources, prompts and a capability of your own are registered on the
**same** server rather than on a second one beside it:

```ts
mcp({
  graph,
  extend: (server) =>
    server.registerResource('guide', 'shop://guide', {
      mimeType: 'text/markdown',
    }, () => ({ contents: [{ uri: 'shop://guide', text: guide }] })),
})
```

## Refusals

A bad argument or a rejected write comes back as the tool's own error text with
`isError` set — something the agent reads and corrects, not a broken connection.
Only the transport itself refuses in HTTP: `405` for any method but `POST`
(there is no SSE stream), `400` for a body that is not one JSON-RPC request,
`401` from your `authenticate`, and `202` for a notification.

## stdio

For an agent that launches the server itself:

```ts
// deno run -A serve.ts
import { stdio } from '@yaks/mcp/stdio'

await stdio({ graph, actor: { by: 'm1' } })
```

It lives in its own module because it is the one part that is not portable — it
reads the process's own streams — so importing `@yaks/mcp` never pulls a runtime
dependency in with it.

## JSON Schema tool declarations

A tool may supply `noun`/`verb` and a complete `inputSchema` instead of a name
and a per-argument Zod `input` object. The server derives the MCP tool name from
the noun and verb — `session_list` from a pair, and the single word itself from
a tool that declared a noun or a verb alone — advertises the original JSON
Schema, and validates arguments through `@yaks/vocab/tools` before calling the
same `run` function. Tools written the older way keep their Zod validation.
Security callbacks are given normalized names in either case.

The MCP SDK's high-level registration currently accepts Zod rather than raw JSON
Schema. For a registry holding both kinds, this adapter builds its own
`tools/list` reply and validates the JSON Schema declarations with the shared
validator. That reply describes the server's initial, fixed registry: adding,
disabling or modifying SDK tools after the server is built is not supported
while JSON Schema tools are present. That is a deliberate limitation of this
adapter, not a second schema compiler.

There is no output declaration: a tool returns bundles, and a failed call is
marked with `isError` and carries an `error` or `exception` bundle describing
what happened.

## Compatibility

**Deno, Node, Bun, and Cloudflare Workers** for `@yaks/mcp`; `@yaks/mcp/stdio`
needs a process, so Deno, Node and Bun. The HTTP transport is stateless — one
JSON-RPC request in, one reply out — so a restart strands nobody and two
isolates need to agree about nothing. Its dependencies are the sibling packages
`@yaks/graph`, `@yaks/api` and `@yaks/vocab`, plus `@modelcontextprotocol/sdk`
and `zod`.

## The family

[@yaks/graph](https://jsr.io/@yaks/graph) owns the bundle format and `apply()`;
[@yaks/vocab](https://jsr.io/@yaks/vocab) describes the components;
[@yaks/query](https://jsr.io/@yaks/query) parses the query string;
[@yaks/api](https://jsr.io/@yaks/api) serves browsers and other programs over
HTTP, and this package serves agents. Compose
[@yaks/fts](https://jsr.io/@yaks/fts) into your storage and a bare word filters
inside `graph_query` too.

## License

Apache-2.0
