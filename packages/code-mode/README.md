# @yaks/code-mode

Short JS/TS executions over a scoped tool registry. `catalog()` preserves each
provider and tool name as an object path; `declarations()` generates TypeScript
from the registry's input and output schemas. `execute()` records nested calls
through the supplied runner with the outer call's actor, instrument and source.
Its `refused` option hears what the bridge refuses before any runner does (a
tool outside the scope, a limit, a malformed argument or `results.read`, a call
after the execution ended) as a runner's `refused` hears its own, each with the
nested call it refused: the id a call keeps from the bridge to the runner, so a
host deduping by call hears each call once. When a tool or the host's
`strangerWrote` option marks a nested answer `heard`, both the nested call's
receipt and the execution's answer carry `heard`.

The host supplies an isolated evaluator, and a `Strip` that reads a script's
TypeScript as JavaScript: yaks.app strips through its compiler Worker, which
carries sucrase so the kernel need not. The yaks.app connector exposes
`code_mode`; omit `script` to read declarations, with `search`, `offset` and
`limit` for discovery. A script is an async function body with `tools` and
`results` in scope. For example, to publish your HTML in an app:

```ts ignore
await tools.yaks.app_new({ slug, title, access: 'public' })
await tools.yaks.app_files({
  app: slug,
  files: [{ path: 'index.html', content: html }],
})
return await tools.yaks.app_deploy({ app: slug })
```

Each function answers the MCP result: `content`, `structuredContent`, and
`isError` for a tool's refusal. Check `isError` before depending on a tool's
success. The execution answers `{value, calls, error?}`: `value` is what the
script returned, and each call is a receipt of its id and exact path, with
`isError` and the first KiB of its words when it failed. Inner results stay in
the isolate: a script reads, filters and joins there, and returns only what the
model needs. `code_mode` itself is excluded from nested discovery and execution.

The host supplies `Kept` so a script can read results the harness saved in the
caller's graph through `await results.read(id)`. Nested tool calls and script
return values remain complete for programs. The agent harness keeps oversized
answers and gives the model a summary after execution.

```ts ignore
let rows = await results.read('result-id')
return rows.filter((row) => row.status === 'open').map((row) => row.id)
```

`results.read` reads the saved value exactly, within the caller's scope. Its
capability is revoked when the execution ends. yaks.app's `result_query` tool
runs jq against the same snapshots. Ordinary graph answers have rows at
`.result`; custom tool answers keep data under `.structuredContent`, with
accompanying text in `.content`.

On yaks.app, a fresh dynamic Worker runs each script with 30 seconds of CPU, 40
seconds of elapsed time, 128 MiB of memory and 64 tool calls. Its tool bridge is
revoked when the execution ends. A script and its ordinary tool arguments each
have a 64 KiB limit. A serialized result, kept result read or script answer has
a 32 MiB limit. A script's failure leaves started writes in flight. A receipt
with `pending: true` means the outcome is still unknown.

The hosted adapter supplies `fs` with a request-local `/tmp` and `/apps/<app>`
for draft files. App file operations use the ordinary `app_files` tool with its
draft selection, permissions and receipts. The host gives the isolate an egress
binding for HTTP requests. Pass `app` to use that app's connection sentinels.
Egress holds the credentials and sends them to destinations the connection
permits.

A host that passes `browser`, puppeteer's module, gives a script that names
`browser` a `browser.launch()`: puppeteer launches on the Worker's
`env.BROWSER`, which the host lends, and every browser the script launched is
closed when the run ends. A script that does not name it loads no puppeteer.

A host that passes `repl` runs the script as a cell of that REPL
(`@yaks/code-mode/repl`). The cell's Worker exports `Cell`, a Durable Object
class the host runs as one facet for every cell, so `storage.sql` and
`storage.kv` are one database across cells. When a cell ends, its top-level
values that structured clone can copy are kept there, and the host keeps their
names and each function and class declaration's source (`cells`), so the next
cell declares them again before its own code (`carry`). `declared` (./scan.ts)
reads what a cell declares from its tokens.

The runtime contract follows Cloudflare's
[Worker Loader API](https://developers.cloudflare.com/dynamic-workers/api-reference/),
[egress control](https://developers.cloudflare.com/dynamic-workers/usage/egress-control/)
and
[custom resource limits](https://developers.cloudflare.com/dynamic-workers/usage/limits/).
