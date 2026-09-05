# @yaks/mcp

The [Model Context Protocol](https://modelcontextprotocol.io) server for a
[@yaks/graph](https://jsr.io/@yaks/graph), as a plain request handler that runs
in any JavaScript environment.

Point it at a graph and an agent can read and write it — over Streamable HTTP
beside your other routes, or over stdio for a local one.

## Install

```sh
deno add jsr:@yaks/mcp
# or: npx jsr add @yaks/mcp
```

## Use

```ts
import { mcp } from '@yaks/mcp'

let door = mcp({ graph, authenticate })

Deno.serve((request) => door(request)) // …or any fetch-style host
```

The handler answers **every** request it is given, so mount it wherever you like
— beside [@yaks/api](https://jsr.io/@yaks/api)'s routes, say:

```ts
let graphDoor = api({ graph, authenticate })
let agentDoor = mcp({ graph, authenticate })

Deno.serve((request) =>
  new URL(request.url).pathname == '/mcp'
    ? agentDoor(request)
    : graphDoor(request)
)
```

The examples below are a bookshop: books with a price and a status, reviews
about them, and members who buy them.

## Five tools, and every one speaks bundles

There is no tool per component here — no `book_shelve`, no `review_write`. A
**bundle** already says everything such a tool would say (which entity, which
components, which columns), so an agent that knows the wire can write anything
your vocabulary declares.

| tool           | what it does                                                   |
| -------------- | -------------------------------------------------------------- |
| `graph_apply`  | bundles in, the batch as applied out                           |
| `graph_query`  | a query line in, bundles out                                   |
| `graph_show`   | entities whole, with what points at them and the edges between |
| `graph_schema` | the index of your words, or one of them in full                |
| `search`       | words, ranked — only when you pass a `search` seam             |

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
// → { bundles: [the book, and each review of it],
//     edges: [{ from: "r1", to: "b1", comp: "review", prop: "book" }] }

// graph_schema — bare, one word, or a kind
{}                      // the index: every component, its line, its columns
{ "component": "book" } // that one whole: types, meaning, references, example
{ "kind": "book" }      // what an entity of that kind is made of
```

`graph_query` takes the query line [@yaks/query](https://jsr.io/@yaks/query)
owns, and an optional `filters` list joined onto it with `&` — dot-param sugar,
one thin layer over the same grammar, not a second one.

An agent that has never seen your vocabulary calls `graph_schema` first. Bare,
it answers the INDEX — every component, the line its schema says about it, and
its column names — small enough to read whole. Named, it answers that component
in full: each column's type and meaning, what is server-owned or unique or kept
as bytes, what points at it and what it points at, a bundle that writes it, and
the page your host documents it on (`guide`). It rarely has to ask at all:
`graph_apply`'s own input schema is that vocabulary, typed, so the write door
teaches itself.

## Output schemas, and what they cost

Every tool declares an `outputSchema` and answers with `structuredContent` (MCP
2025-06-18), so a caller reads a described value instead of parsing prose. The
bundle schema is not hand-written — it is DERIVED from your vocabulary, so a
component you add appears in it with nobody editing anything.

That schema is sent to the agent **before it asks anything**, so its size is
context spent up front. Hence a choice:

```ts
mcp({ graph, schema: 'names' }) // the default
mcp({ graph, schema: 'full' })
```

- **`names`** — every component and every column name, values left open.
- **`full`** — each column at its declared type, with an enum's members listed.

Over a 138-component vocabulary that is 17.8 KB versus 28.0 KB **per
bundle-returning tool**. Take `full` when agents write bundles all day and the
types earn their bytes; take `names` when they mostly read.

The derivation is exported, so you can build the same schema for your own
handler:

```ts
import { bundleSchema } from '@yaks/mcp'

let bundle = bundleSchema(shop, { depth: 'full' })
```

## The schema describes, the server decides

A client lists the tools once, at `initialize`, and holds that list — with the
schemas in it — for the whole conversation. Your vocabulary keeps growing under
it. So the write schema is **open**: every declared column is typed, named and
described, and an undeclared one is not refused there. A closed schema would
have a client's stale copy refuse a column that now exists, in the client, where
no server can explain it.

Admission is the authority. A column nobody declared is refused by
[@yaks/graph](https://jsr.io/@yaks/graph), naming the column, naming the columns
the component does declare, and pointing at `graph_schema` — which answers what
this graph knows _right now_.

## A tool list goes stale

The other half of the same problem: a tool a release added is one the agent
cannot see, and a tool that went is one it calls into a refusal.
`notifications/tools/list_changed` is the protocol's answer, and a host that
holds a stream should send it. But a client without one hears nothing, so say it
again where the agent is certainly reading — on the next result:

```ts
import { roster, rosterLine, rosterVersion } from '@yaks/mcp'

let version = rosterVersion(roster(opts), release) // name the list you serve
// …remember it per session at initialize, then:
mcp({ ...opts, roster: (names) => rosterLine(cached[session], names) })
```

`roster` is the names this server lists; `rosterVersion` hashes them with your
release id, so it moves when either does; `rosterLine` is the sentence:

> The tool list changed since you connected (new: mail_list, mail_send; gone:
> vocab). Reconnect to see them, or ask `about`.

What it answers rides as a trailing content block, so a JSON answer stays JSON.
Say it once per changed set — record the new roster when you say it.

**New capability = new component, not a new tool.** The generic tier already
writes anything your vocabulary declares, and a component appears in
`graph_schema` and in the write schema by itself. A tool per feature is a roster
that moves under every client you have.

## The door is where trust lives

A bundle can say anything, including whose name is on it. So a server is built
per request around the identity your `authenticate` returned, and every batch a
tool applies is signed with that — never with what the client sent:

```ts
let authenticate = (request: Request) => {
  let token = request.headers.get('authorization')
  return token ? { eid: memberFor(token) } : null
}
```

Return `null` and writes land unattributed; throw `Unauthorized` and the request
is answered with a 401. It is the same `Authenticate` seam
[@yaks/api](https://jsr.io/@yaks/api) takes, and the same signing, so both doors
onto one graph agree about who is writing.

Nothing else about a call is trusted either: which columns a caller may write,
whether a precondition still holds, and what a delete takes with it are all
[@yaks/graph](https://jsr.io/@yaks/graph)'s to decide.

## Plugins bring tools

A plugin contributes tools the same way it contributes components and hooks:

```ts
let shelf = {
  name: 'shelf',
  tools: [{
    name: 'shelve',
    description: 'put a book on the shelf',
    input: { book: z.string().describe('the book to shelve') },
    run: (args, ctx) =>
      ctx.apply([{
        entity: { eid: String(args.book) },
        book: { status: 'shelved' },
      }]),
  }],
}

graph.use(shelf)
```

They are listed beside the generic tier, with the same signing and the same
reply shape. A tool is handed the arguments the client sent (already checked
against its `input`) and a `ToolCtx`: the graph, who is asking, a signed
`apply`, and a `read`. Schemas are [Zod](https://zod.dev), because the MCP SDK
takes Zod.

A tool whose words and value differ answers with a `Say`, and one that carries
`meta` has it handed to the client verbatim as `_meta`:

```ts
import { Say } from '@yaks/mcp'

{
  name: 'shelf',
  description: 'what is on the shelf',
  meta: { ui: { resourceUri: 'ui://shop/shelf' } },
  run: () => new Say('two books here', { books: 2 }),
}
```

The text is what a client without schemas reads; the data goes to one that
renders the answer, unwrapped — a plain value rides under `result` instead.

## When a host serves more than tools

`extend` is handed the SDK's own server once the tools are on it, so resources,
prompts and a capability of your own go on the **same** server rather than
beside it:

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
Only the transport itself refuses in HTTP: `405` for anything but a `POST`
(there is no SSE stream), `400` for a body that is not one JSON-RPC request,
`401` from your `authenticate`, and `202` for a notification.

## stdio

For an agent that launches the server itself:

```ts
// deno run -A serve.ts
import { stdio } from '@yaks/mcp/stdio'

await stdio({ graph, actor: { eid: 'm1' } })
```

It lives in its own module because it is the one part that is not portable — it
reads the process's own streams — so importing `@yaks/mcp` never drags a runtime
in with it.

## Compatibility

**Deno, Node, Bun, and Cloudflare Workers** for `@yaks/mcp`; `@yaks/mcp/stdio`
needs a process, so Deno, Node and Bun. The HTTP door is stateless — one
JSON-RPC request in, one reply out — so a restart strands nobody and two
isolates need to agree about nothing. Its dependencies are the sibling packages
`@yaks/graph`, `@yaks/api` and `@yaks/vocab`, plus `@modelcontextprotocol/sdk`
and `zod`.

## The family

[@yaks/graph](https://jsr.io/@yaks/graph) owns the bundle wire and `apply()`;
[@yaks/vocab](https://jsr.io/@yaks/vocab) describes the components;
[@yaks/query](https://jsr.io/@yaks/query) parses the query line;
[@yaks/api](https://jsr.io/@yaks/api) is the door for browsers and other
programs, and this is the door for agents. Compose
[@yaks/fts](https://jsr.io/@yaks/fts) into your storage and a bare word filters
inside `graph_query` too.

## License

Apache-2.0
