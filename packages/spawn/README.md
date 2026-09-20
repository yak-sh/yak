# @yaks/spawn

A session whose provider is a COMMAND: the agent started detached on this host,
and its JSONL stdout read back as that transcript's entries.

```sh
deno add jsr:@yaks/spawn
```

It ships no components. A session is [@yaks/session](../session)'s transcript,
the run is [@yaks/process](../process)'s `process` on that same entity, and the
request is the `using{provider, model, effort}` on the transcript's first entry
— which is what @yaks/session's own vocabulary says a session is asked for. This
package is the three of them meeting.

## The request is a batch

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

There is no launch route and no spawn column. `@yaks/spawn/effects` answers that
commit: it reads the provider's name off its entity, and where that name is a
command here — `claude`, `codex`, or whatever table the host composed — starts
it. A provider whose transport is `http` is not in the table, so it stays the
in-process daemon's ([@yaks/session](../session)'s `react`). The effort is
checked against the `efforts` its model serves before anything is launched.

## The run

`start` launches through @yaks/process: a launcher that exits at birth, a
`setsid` wrapper in its own `systemd-run --user --scope` unit, a pidfile and a
code file. So the agent outlives this server, a restart takes nothing with it,
and nothing here reaps anything.

The `process` row lands on the SESSION's own entity — one entity, one run — so
"who is running this transcript" and "what is running" are one row.

## The file is the log, the graph is the transcript

The child's stdout is @yaks/process's `<eid>.out`, appended by the wrapper and
durable across every restart. What the graph holds is the transcript read out of
it: one entry per line the adapter recognizes, wearing `imported{source, line}`.
That stamp is the cursor too — the highest line already imported is where the
next read starts — so importing is exactly-once with no column to keep current,
and `@yaks/spawn/boot` picks a run back up after a restart by watching its pid
again and reading its log on.

A line the adapter does not recognize, and a line that is not JSON at all,
becomes nothing: the file keeps it.

A provider that ends without a terminal event — killed, crashed, or simply done
talking — still ends: the tail writes the `stop` itself, with the exit code
beside it when it was not 0. The process ending is observed; it is not inferred
from the conversation.

## Down

A `stop` on the session's own entity, beside its process, is the brake: TERM the
process group, KILL what is still there after the grace. It is the same word
@yaks/process reads beside a `service` row, and it never collides with the
`stop` that marks the end of a transcript, because one rides a session and the
other rides a line.

## What an adapter says, and what it does not

A provider is its argv and the reader that turns one line of its stream into the
comps an entry wears. What an adapter deliberately does NOT say is `call` and
`result`: a provider's tool use already happened, in its own process, and
written as a `call` row it would be handed to THIS host's runner, which runs any
call naming a tool it has ([@yaks/tools](../tools)) — and the tools a fleet
agent reaches are exactly this host's. The word for "somebody else already ran
this" is not in the vocabulary yet, so a tool use stays in the file.

## Composing it

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

The options say where an agent runs and how often its log is read. The providers
are not among them — an adapter is a function, not a value a config can hold —
so a host with one of its own writes a module:

```ts
import { spawning } from '@yaks/spawn/effects'
import { adapters } from '@yaks/spawn'

export let effects = spawning({ adapters: { ...adapters, mine } })
```
