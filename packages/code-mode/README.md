# @yaks/code-mode

Short JS/TS executions over a scoped tool registry. `catalog()` preserves each
provider and tool name as an object path; `declarations()` generates TypeScript
from the registry's input and output schemas. `execute()` records nested calls
through the supplied runner with the outer call's actor, instrument and source.

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
the sandbox: a script reads, filters and joins there, and returns only what the
model needs. `code_mode` itself is excluded from nested discovery and execution.

The host supplies `Kept` to keep large results in the caller's graph. Return
values over 256 KiB and tool results beyond the execution's 4 MiB read budget
are kept whole, and answered with their id, size, shape and preview. A script
can read a kept result through `await results.read(id)` and manipulate it
without sending it through the model context:

```ts ignore
let rows = await results.read('result-id')
return rows.filter((row) => row.status === 'open').map((row) => row.id)
```

`results.read` reads the kept value exactly: a script's return value is kept as
that value, and a nested tool's result is kept as its MCP result including
`content`, `structuredContent` and `isError`. Reads use the host's scope and are
revoked when the execution ends. Without `Kept`, results stay inline.

yaks.app also keeps model-facing tool answers over 16 KiB. Its `result_query`
tool runs jq against an id and keeps a large query result again. Ordinary graph
answers have rows at `.result`; custom tool answers keep their data under
`.structuredContent`, with complete text and images beside it.

The Cloudflare adapter uses a fresh Worker Loader isolate with an empty `env`,
`globalOutbound: null`, and one RPC capability passed as an argument. The
isolate has 128 MiB of memory, 100 ms CPU and 32 subrequests. The host revokes
the bridge after 30 seconds or completion. A trusted child deadline settles its
invocation after 30 seconds too. The Loader exposes no hard termination method;
CPU limits stop synchronous loops, and revocation prevents late tool calls. The
returned RPC promise is disposed when the host finishes. Executions permit 16
tool calls and 64 KiB of script and JSON arguments per call. Tool results count
once toward the 4 MiB retention threshold, by their structured form where one
exists. A serialized MCP result, kept result read or script answer over 32 MiB
is refused for system safety; ordinary retention thresholds never reject or
truncate a result. Each limit's error says what to do instead (`TOO`). Discovery
is paged and uses the same result retention.

A script's failure does not undo started writes. A receipt with `pending: true`
means the call was still in flight when the execution answered; it may finish
later. Scripts have no network, secrets, filesystem or ambient bindings. Tools
retain their own authorization and I/O boundaries. Durable workflows and human
waits are separate from these short executions.

The runtime contract follows Cloudflare's
[Worker Loader API](https://developers.cloudflare.com/dynamic-workers/api-reference/),
[egress control](https://developers.cloudflare.com/dynamic-workers/usage/egress-control/)
and
[custom resource limits](https://developers.cloudflare.com/dynamic-workers/usage/limits/).
