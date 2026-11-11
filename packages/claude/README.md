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

Each step is answered by its own CLI process in an empty temporary directory,
which reads stream-json input and writes stream-json output. The step's explicit
system prompt arrives in the process's `initialize` control request, and the
graph history as JSON transcript data in one user message. Settings sources,
hooks, slash commands, auto-memory and nonessential traffic are disabled.
`--tools ''` disables built-ins. The harness is an SDK-hosted MCP server
(`sdkMcpServers`): the CLI asks it for its tools over the same stdin and stdout,
and it advertises exactly the request's tool definitions. It **never executes a
tool**: a `tools/call` is never answered. On the completed assistant tool-use
frame the adapter kills the child, returning neutral calls to the harness, whose
ordinary loop persists and executes them. `--max-turns 1` also bounds the CLI's
loop. Text-only completion must end in a successful result.
`--include-partial-messages` makes the CLI send text as it is written, and each
piece reaches the request's `onText` as it arrives; the completed frame tells
only what no piece carried. There are no retries within this adapter; durable
submission/acknowledgement uses the same model callbacks as the HTTP providers.

The graph records each ask, assistant text, requested call, harness result, CLI
session/message ids and reported token usage: input, output, what was read from
the prompt cache and what was written to it, a write kept an hour counted apart
since it lists at more. The reply names the release its alias resolved to, and
the request is weighed at that release's price (@yaks/session `ask.served`).
Claude's displayed dollar estimate is not a subscription charge and is not
recorded as a paid API bill. Cancellation kills the child and removes its
directory.

## A process started before its step

The CLI takes 0.3–0.6 s to start, before it reads its input. Nothing of a step
is in its arguments except the model and effort, so each step takes a process
already started for them and, once its own input is sent, starts the one the
next step takes. A process answers one step and is then killed: one step's input
never reaches another's reply. A waiting process doesn't hold its host open
(`unref`); it reads end-of-file and exits when the host does. Each holds about
190 MB while it waits, one for each model and effort asked for. The model is
`AsyncDisposable`, which ends the waiting ones.

Through `/model/step` on this box, one-word `haiku` steps 3 s apart reached
first text in 612–2015 ms (median 876) this way, and 858–2949 ms (median 1145)
with a process started per step. workers/yak/README.md has the rest of an
Operator step's time.

## When the cache goes cold

The CLI chooses how long the prompt cache keeps a prefix, and a reply names no
expiry. `mark(reply, cache)` writes
`claude{response_id, session_id, cache_expires_at}`: the expiry is the request's
start plus the lifetime its provider row records, `provider{cache_retention}` in
seconds ([@yaks/model](../model/README.md), "Cached-prefix expiry"). Where the
row records none the expiry is null, which every reader takes as cold.

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
assistant/tool-result wire blocks), for a single source of truth. Each item is
its own text block of the one user message, so the next ask's message begins
with this one's and the prompt cache holds all but the items since. Sent as one
string, the whole transcript missed the cache on every ask: a second ask on a
27K-token transcript wrote 27,741 tokens to the cache, and as blocks it writes
614 and reads 34,857. `--no-session-persistence` prevents saved CLI conversation
threads. CLI aliases may change with Claude Code. `--bare` cannot be used for
this subscription-backed path: its help explicitly disables OAuth. Images, typed
questions and model-native inputs fail explicitly before spending.

A `native` marker on harness-created/delegated transcripts distinguishes them
from unmarked managed Claude sessions. Spawn ignores the former; the native
provider leaves the latter alone, including existing heal fixers. The spawn
adapter remains for outside Claude agents, their built-in tools and saved
threads. Moving heal requires changing its opener/machine/persona preparation
and process-based concurrency accounting; it is not switched by this package.

Tested against Claude Code 2.1.322. Tests hand `read` the CLI's frames in
process, never a paid Claude invocation. A live probe should use `--model haiku`
and stay short.
