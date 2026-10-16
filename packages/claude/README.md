# @yaks/claude

A native harness `Model` backed by the owner's signed-in `claude -p`. This is
not the outside-agent adapter in `@yaks/spawn`: the harness owns execution,
permissions, machine routing, calls, results and the transcript.

Compose `@yaks/claude` alongside `@yaks/harness` to declare its reply metadata,
then choose the provider and a Claude Code model alias or full name:

```sh
yak session new 'Read the task graph' --provider claude --model haiku
```

The harness host needs the `claude` executable and subscription sign-in. Model
and provider selection remain graph rows (`@yaks/model`); `list()` advertises
`haiku`, `sonnet`, `opus`, resolved by the installed CLI. No default model,
release, context window or API price is invented here. A full model name can
also be requested and confirmed by the normal provider resolver.

## One turn, one owner of tools

Each ask starts a new CLI process in an empty temporary directory, supplies an
explicit system prompt and the graph history as JSON transcript data through
stream-json input, and reads stream-json output. Settings sources, hooks, slash
commands, auto-memory and nonessential traffic are disabled. `--tools ''`
disables built-ins. A strict, capability-URL loopback MCP server advertises
exactly the request's tool definitions. It **never executes a tool**. If Claude
starts dispatching a call, the server withholds its response. On the completed
assistant tool-use frame the adapter kills the child, returning neutral calls to
the harness, whose ordinary loop persists and executes them. `--max-turns 1`
also bounds the CLI's loop. Text-only completion must end in a successful
result. There are no retries within this adapter; durable
submission/acknowledgement uses the same model callbacks as the HTTP providers.

The graph records each ask, assistant text, requested call, harness result, CLI
session/message ids and reported token usage. Claude's displayed dollar estimate
is not a subscription charge and is not recorded as a paid API bill.
Cancellation kills the child and releases the temporary MCP server/directory.

## What is not graph-native

`claude` owns subscription authentication, transport/init diagnostics, internal
prompt additions, thinking and token/cache accounting. Its private state cannot
be exported into the neutral `Model` interface. We retain reported token usage,
not hidden thinking or CLI diagnostic traffic. The CLI is a host integration,
not a session machine; it has no task checkout and its built-ins cannot work on
one. Like other process integrations this is not an OS security sandbox.

We deliberately do **not** use `--resume`. A resumed CLI conversation would own
context, compaction, instructions and tool results outside the graph. Instead,
the graph history is replayed as data on every ask (not native Anthropic
assistant/tool-result wire blocks); this sacrifices exact cache/prompt fidelity
for a single source of truth. `--no-session-persistence` prevents saved CLI
conversation threads. CLI aliases may change with Claude Code. `--bare` cannot
be used for this subscription-backed path: its help explicitly disables OAuth.
Images, typed questions and model-native inputs fail explicitly before spending.

A `native` marker on harness-created/delegated transcripts distinguishes them
from unmarked managed Claude sessions. Spawn ignores the former; the native
provider leaves the latter alone, including existing heal fixers. The spawn
adapter remains for outside Claude agents, their built-in tools and saved
threads. Moving heal requires changing its opener/machine/persona preparation
and process-based concurrency accounting; it is not switched by this package.

Tested against Claude Code 2.1.293. Tests use a fake subprocess, never a paid
Claude invocation. A live probe should use `--model haiku` and stay short.
