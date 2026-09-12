# @yaks/tools

Execute recorded tool calls against a graph and store their outcomes. The
package uses `Tool` from `@yaks/graph`; it does not define another command
contract or require an agent, session, provider, or MCP connection.

## Vocabulary

`toolsDoc` declares:

- `tool{name, description}`: a registered tool's graph identity.
- `call{to, args, id?, source?}`: a tool reference and JSON arguments. `id` is
  an optional transport correlation ID; `source` is optional provenance.
- `execution{state}`: `started` before the handler runs, `completed` with its
  result.
- `result{call, ms}`: a result's call reference and execution duration.
- `content{body, source?}`, `error{code}`, and `exception`: output and
  diagnostics.

`callDoc` omits `tool`, and `toolDoc` contains only `tool`, for applications
that compose existing vocabularies. Import `@yaks/tools/vocab` when only
declarations are needed; it does not load the executor or JSON Schema validator.

## Execute a call

```ts
import { graph, type ToolCtx } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { executeCall, graphInvocation, toolsDoc } from '@yaks/tools'

const vocab = loadVocab([toolsDoc])
const g = graph({ vocab, storage: ram(vocab) })
const context: ToolCtx = {
  graph: g,
  actor: null,
  apply: (change) => g.apply(change),
  read: (query) => g.read(query),
}
await g.apply([
  { entity: { eid: 'echo' }, tool: { name: 'text_echo' } },
  {
    entity: { eid: 'request' },
    call: { to: 'echo', args: '{"text":"hello"}' },
  },
])
await executeCall(g, 'request', {
  resolve: (id) =>
    id === 'echo'
      ? graphInvocation({
        noun: 'text',
        verb: 'echo',
        description: 'Return the supplied text',
        inputSchema: {
          type: 'object',
          required: ['text'],
          properties: { text: { type: 'string' } },
        },
        run: (args) => args.text,
      }, context)
      : undefined,
})
```

`graphInvocation` preserves the caller-supplied authorization context and uses
the shared JSON Schema validator. Legacy per-property schemas with a `parse`
method are also supported. Other schemas need an explicit adapter; they are not
inferred. An `Invocation` can instead supply `run`, `inputSchema`, optional
additional validation, and output formatting directly. This supports existing
host tool interfaces without making the executor depend on them.

The default result formatter preserves strings and JSON-serializes other values.
Binary artifacts belong in external blob storage; handlers return references.

## Scheduling and sessions

The host decides when a call is eligible and invokes `executeCall`. It can do so
from a command, a worker queue, or a handler registered with `@yaks/effects`.
Importing this package does not start an observer, worker, or daemon. Keep a
single scheduling owner; the executor does not provide a distributed scheduler.

`@yaks/session` uses this same executor under its existing execution lock and
shutdown/drain handling. Its own precommit rule adds `entry{session}` to results
whose calls belong to a transcript. A separate sequencing rule assigns `seq`.
Results of non-session calls remain ordinary graph entities. Tool failure
diagnostics reference their call through `content.source` and receive the same
session association when applicable.

The session adapter supplies trusted session context for tools such as fork and
wait. Pool slot release/reacquisition remains the scheduler's responsibility.
Tool registries are resolved by the host; callers should provide the handler
snapshot appropriate to the issued call.

## Failure and recovery

Concurrent calls to `executeCall` on the same Graph share one promise. A durable
precondition protects the start record against another graph writer. Calls with
existing results return those results without executing again.

Malformed arguments, validation failures, and missing tools produce an `error`
and a paired result. Handlers can throw `CallError` for other expected refusals.
Unexpected handler errors produce an `exception`, notify the supplied reporter,
and still produce a paired result.

A started call without a recorded result throws `UnfinishedCall`. The executor
never automatically retries it. A process can fail after an external action
succeeds but before its result commits; there is no exactly-once guarantee.
Inspect or reconcile that outcome explicitly. Existing session orphan-call
recovery still applies to older calls that lack execution records.

Result persistence failures propagate and leave the start record intact. A
reporter must not throw if the host expects failure results to be recorded.
Results commit individually; hosts must wait for all required results before
requesting another model turn. The session scheduler enforces this using its
existing open-call checks and per-session execution serialization.
