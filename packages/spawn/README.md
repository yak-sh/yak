# @yaks/spawn

`@yaks/spawn` starts supported agent CLIs as detached processes and imports
their JSON-lines output into `@yaks/session` transcripts.

```sh
deno add jsr:@yaks/spawn
```

The package defines no process or transcript components. Sessions and entries
come from `@yaks/session`; `process` and `exit` come from `@yaks/process`;
`provider`, `model`, and `using` come from `@yaks/model`. Its vocabulary
document declares the `session spawn`, `session wait`, and `session peek` tools.

## Starting an agent

Write a session and its first input in one transaction. A **bundle** is one
entity's components as a JSON object, and a **batch** is a list of changes
applied in one transaction.

```jsonc
[
  { "entity": { "eid": "$session" }, "session": {} },
  {
    "entity": { "eid": "$entry" },
    "entry": { "session": "$session" },
    "content": { "body": "fix T-1" },
    "using": { "provider": "Y-2", "model": "O-7", "effort": "high" }
  }
]
```

The `@yaks/spawn/effects` handlers run after the batch commits. They read the
provider's `name`, select the matching `claude` or `codex` adapter, validate the
requested effort against the model, and start the command. Providers handled
over HTTP have no command adapter and remain the responsibility of the
in-process `@yaks/session` daemon.

The process is stored on the session entity. It runs through `@yaks/process` in
a detached systemd user scope, so it can outlive the process that opened the
graph. That graph-opening process is the **host**. On host startup, the effects
take the `@yaks/spawn` lease and resume monitoring active runs, preventing two
hosts from importing the same logs. Effect handlers start the long-running work
without awaiting it; failures go to the configured `report` callback.

<a id="how-the-child-process-is-started"></a>

The package does not reap child processes.

## Logs and transcript storage

<a id="the-log-file-and-the-transcript"></a>

Standard output is stored in the process directory as `<session-eid>.out`. Each
recognized line becomes a transcript entry with `imported{source, line}`. The
largest imported line number is the durable read position, so monitoring can
resume after a restart without a separate cursor. Unrecognized and invalid JSON
lines remain in the file and are not entries.

When the process exits, the follower appends a transcript `stop` entry. A
nonzero exit is recorded with that entry. Writing `stop` on the session entity
requests termination: SIGTERM to the process group, then SIGKILL after the
configured grace period. A `stop` on an entry only ends the transcript.

<a id="stopping-a-run"></a>

Adapters omit provider-side tool calls from the graph. Those calls have already
run in the agent process; recording them as session `call` components would
allow the host's tool runner to execute them again.

<a id="what-an-adapter-is"></a>

An adapter contains a provider command line and a parser that converts one
output line into transcript components. Providers and the models they serve
remain graph entities, so adding a model does not require a package release.

## CLI and tool use

<a id="the-three-tools"></a>

```sh
yak session spawn T-37667 --provider claude --model opus --effort high --wait
yak session wait S-4211 --timeout 45m
yak session peek S-4211 -n 20
```

The MCP names are `session_spawn`, `session_wait`, and `session_peek`. `spawn`
creates the session, first entry, and claim on the task. It calls
`graph.apply()` itself because the post-commit effect must start the process
before `--wait` can monitor it. `wait` polls the graph. A session with a
`process` ends when that process exits, even if its transcript already has a
`stop`; a session without a process ends when its transcript reaches `stopped`
or `failed`. It reports the brief and exit code, and reaching its timeout leaves
the run active. `peek` renders recent entries from the graph.

## Configuration

```jsonc
{
  "plugins": [
    "@yaks/session",
    "@yaks/process",
    "@yaks/model",
    { "use": "@yaks/spawn", "with": { "cwd": "/srv/work", "poll": 250 } }
  ]
}
```

Effects accept `cwd`, process-file `dir`, polling interval `poll`, and kill
`grace`. Tools accept `poll`, a human-readable default `timeout` such as `45m`,
and the number of `lines` shown by `peek`.

Custom adapters are functions and cannot be represented in JSON configuration:

```ts
import { adapters } from '@yaks/spawn'
import { spawning } from '@yaks/spawn/effects'

export const effects = spawning({ adapters: { ...adapters, mine } })
```

## Exports

The main module exports the built-in `claude` and `codex` adapters, the
`adapters` table, adapter types, and the lower-level `asked()`, `imported()`,
`follow()`, `start()`, `resume()`, and `down()` functions. Additional entry
points are:

- `@yaks/spawn/vocab`: `spawnDoc` and `docs`;
- `@yaks/spawn/effects`: `effects`, `spawning()`, and effect configuration;
- `@yaks/spawn/tools`: `runs()`, duration parsing, and brief formatting.

The launcher requires Linux, `setsid`, and a systemd user manager.
