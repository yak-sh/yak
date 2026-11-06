# @yaks/code-mode

Short JS/TS executions over a scoped tool registry. `catalog()` preserves each
provider and tool name as an object path; `declarations()` generates TypeScript
from the registry's input and output schemas. `execute()` records nested calls
through the supplied runner with the outer call's actor, instrument and source.

The host supplies an isolated evaluator, and a `Strip` that reads a script's
TypeScript as JavaScript: yaks.app strips through its compiler Worker, which
carries sucrase so the kernel need not. The yaks.app connector exposes
`code_mode`; omit `script` to read declarations, with `search`, `offset` and
`limit` for discovery. A script is an async function body with `tools` in scope.
For example, to publish your HTML in an app:

```ts ignore
await tools.yaks.app_new({ slug, title, access: 'public' })
await tools.yaks.app_files({
  app: slug,
  files: [{ path: 'index.html', content: html }],
})
return await tools.yaks.app_deploy({ app: slug })
```

Each function answers the MCP result: `content`, `structuredContent`, and
`isError` for a tool's refusal. The execution answers `{value, calls, error?}`;
each call has its id, exact path and result. Check `isError` before depending on
a tool's success. `code_mode` itself is excluded from nested discovery and
execution.

The Cloudflare adapter uses a fresh Worker Loader isolate with an empty `env`,
`globalOutbound: null`, and one RPC capability passed as an argument. The
isolate has 128 MiB of memory, 100 ms CPU and 32 subrequests. The host revokes
the bridge after 30 seconds or completion. A trusted child deadline settles its
invocation after 30 seconds too. The Loader exposes no hard termination method;
CPU limits stop synchronous loops, and revocation prevents late tool calls. The
returned RPC promise is disposed when the host finishes. Executions permit 16
tool calls, 64 KiB of script and JSON arguments per call, and 256 KiB of
combined returned JSON. Oversized results keep their call id and an explicit
omission error. Discovery is paged and bounded too.

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
