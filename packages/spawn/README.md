# @yaks/spawn

Runs an agent CLI — `claude`, `codex` — as a detached child process, and reads
its JSON-lines stdout back into the graph as a session transcript.

```sh
deno add jsr:@yaks/spawn
```

This package defines no components of its own. It connects three that already
exist:

- the session and its entries are [@yaks/session](../session)'s `session` and
  `entry` components;
- the running child process is [@yaks/process](../process)'s `process`
  component, stored on that same session entity;
- what was asked for is the `using{provider, model, effort}` component on the
  session's first entry.

Throughout this README, "the server" means whichever process opened the graph
and loaded this package — usually a long-running `yak serve`, sometimes just the
CLI.

## Starting an agent

There is no HTTP endpoint that launches an agent, and no `launch` column.
Instead you insert two rows — a session, and its first entry — and committing
them is the request:

```jsonc
[
  { "entity": { "eid": "$s" }, "session": {} },
  {
    "entity": { "eid": "$e" },
    "entry": { "session": "$s" },
    "content": { "body": "fix T-1" },
    "using": { "provider": "Y-2", "model": "O-7", "effort": "high" }
  }
]
```

That array is one transaction: `graph.apply()` writes all of it or none of it.

`@yaks/spawn/effects` exports handlers that run after such a transaction
commits. When a `using` component appears on a session's first entry, the
handler reads the provider entity it points at, reads that provider's `name`,
and looks the name up in this package's adapter table — `claude`, `codex`, or
any the server added. If there is a match, it runs that command. A provider
whose transport is `http` is not in the table, so nothing is launched here and
[@yaks/session](../session)'s in-process `react` handles it instead. The
requested effort is validated against the `efforts` the model lists before
anything starts.

## The three tools

`@yaks/spawn/tools` exports the implementations of the three tools declared with
`tool: true` in `vocab.json`. They are this package's whole public interface:

```sh
yak session spawn T-37667 --provider claude --model opus --effort high --wait
yak session wait S-4211 --timeout 45m
yak session peek S-4211 -n 20
```

`spawn` inserts the session, its first entry, and the session's claim on the
task. `wait` blocks until the run is over, then prints the session's brief and
its exit code. `peek` prints the transcript out of the graph — not out of the
log file. Over MCP the same three are named `session_spawn`, `session_wait` and
`session_peek`.

`spawn` calls `graph.apply()` itself, rather than returning the rows for the
tool runner to insert. That is unusual here — every other tool in these packages
returns rows and lets the runner commit them — but the child process does not
exist until the transaction has committed, because the effect handler runs after
the commit. A tool that only returned the rows could not then watch what it
started, and `--wait` would have nothing to wait for.
[@yaks/process](../process)'s `shell` tool works the same way, for the same
reason.

`wait` polls the graph on the same interval the logs are read on; there is no
separate notification channel. Whether a run has finished depends on what is
behind the session. If it has a `process` component, the run is over when that
process exits — a provider often prints its final event and then lingers, so its
own `stop` entry does not mean the run ended. A session with no process is over
when its transcript ends. If `wait` reaches its timeout it reports that the run
is still going and leaves it alone; killing it is what `stop` is for.

## How the child process is started

`start` launches through @yaks/process: a launcher that exits immediately, a
`setsid` wrapper running inside its own `systemd-run --user --scope` unit, a
pidfile, and a file holding the exit code. The agent therefore outlives the
server, restarting the server does not kill it, and nothing in this package
reaps child processes.

The `process` component is written on the session's own entity, so "which
session is this" and "which process is running it" are the same row.

## The log file and the transcript

The child's stdout is written to @yaks/process's `<eid>.out` by the wrapper, and
survives restarts. The graph stores the transcript read out of that file: one
entry per line the adapter recognizes, each with an `imported` component
recording the source file and the line number. That also serves as the read
position — the highest line number already imported is where the next read
begins — so every line is imported exactly once, with no cursor column to keep
up to date. When a new server process opens the graph, the `created(process)`
handler picks up runs that are still going, watching their pids again and
reading their logs on from there.

Lines the adapter does not recognize, and lines that are not JSON at all, do not
become entries. They stay in the file.

A provider that exits without printing a final event — killed, crashed, or
simply finished — still ends the transcript: the code tailing the log writes the
`stop` entry itself, with the exit code beside it when it was not 0. The end of
a run is read from the process, never inferred from the conversation.

## Stopping a run

Writing a `stop` component on the session's own entity, next to its `process`,
kills the run: SIGTERM to the process group, then SIGKILL to whatever is still
alive after the grace period. It is the same component @yaks/process reads next
to a `service` row. It does not conflict with the `stop` that marks the end of a
transcript, because that one is written on an entry and this one on the session.

## What an adapter is

An adapter is a provider's argv, plus a function that converts one line of its
output into the components of a transcript entry. Which providers exist, and
which models each one serves, is graph data ([@yaks/model](../model)'s
`provider` and `model` entities), so adding a model means inserting a row, not
cutting a release.

Adapters deliberately never produce `call` and `result` components. The provider
already ran its own tool calls, in its own process. Written into the graph as a
`call` row, the server's tool runner ([@yaks/tools](../tools)) would execute any
call naming a tool it has, running them a second time. No component yet means
"another process already ran this", so tool calls stay in the log file and out
of the transcript.

## Configuration

```jsonc
// yak.json
{
  "db": "graph.db",
  "plugins": [
    "@yaks/session",
    "@yaks/process",
    "@yaks/model",
    { "use": "@yaks/spawn", "with": { "cwd": "/srv/work", "poll": 250 } }
  ]
}
```

The options set the working directory the agent runs in (`cwd`), how often its
log is read (`poll`, in ms), how long `wait` waits by default (`timeout`,
written the way a person writes a duration: `45m`), and how many entries `peek`
prints (`lines`).

Providers cannot be configured this way, because an adapter is a function and
config holds only JSON. To add one, import `spawning` and pass your own adapter
table:

```ts
import { spawning } from '@yaks/spawn/effects'
import { adapters } from '@yaks/spawn'

export let effects = spawning({ adapters: { ...adapters, mine } })
```
