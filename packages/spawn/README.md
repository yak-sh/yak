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

The task body is the agent's spec. Create it, optionally edit it, and spawn:

```sh
yak task new "Fix the parser" --body @brief.md
yak task update T-123 --body @revised-brief.md
yak session spawn T-123 --provider codex --model gpt-6.1-sol --effort high
```

`--provider claude` uses Claude Code through the same lifecycle. Spawn takes the
claim atomically and includes the task body in the request. With `worktrees`
configured, each run has its own branch off main, in a checkout made from a
spare cut ahead of time (@yaks/git/host `keepSpare`), so a run starts about a
second after it is asked rather than after a whole checkout and install; each
launch cuts the next spare. Its final report becomes a comment on the task and a
knock to the spawning session (or, once that is over, the nearest session up its
line that can hear), delivered whole through the session bus that
`yak session listen` reads: one knock for the run's work on the task. A
provider's subagents run in its process and stop when it ends. A claude run
waits on its background agents after its last turn, with no time limit, so they
finish and report; a run stopped or crashed still takes them down, so the report
names each subagent whose transcript never settled, whatever the run's last
words said. Dirty or unlanded work is kept; landed checkouts and their branches
are removed after the run ends.

Write a session and its first input in one transaction. A **bundle** is one
entity's components as a JSON object, and a **batch** is a list of bundles
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
CLI the provider speaks (`provider.api`, else its `name`), select the matching
`claude` or `codex` adapter, validate the requested effort against the model,
and start the command: the adapter's own program, or the one the row names in
`provider.command`. A request that names a provider alone runs the model in the
provider's own `using{model}`, so the command is told its model and the run's
asks name it; Codex's JSON output never says which model answered, so a run left
to its CLI's default could not be priced. Providers handled over HTTP have no
command adapter and remain the responsibility of the in-process `@yaks/session`
daemon.

The process is stored on the session entity. It runs through `@yaks/process` in
a detached systemd user scope, so it can outlive the process that opened the
graph. That graph-opening process is the **host**. The host that stays up holds
the `@yaks/spawn/service` duty under the `@yaks/spawn` lease, renewed for as
long as it runs, and resumes monitoring active runs, so no two hosts import the
same logs. It also takes up a run that is over but whose transcript never ended
(its log was left unread partway), and reads it to its end. A one-shot command
adopts no run: its tails would outlive the lease it gives back when it closes.
Start effects await recording the child process; log following runs in the
background, with failures sent to the configured `report` callback, which a host
points at its tracker.

A run's `process{watcher}` is the process that took the session for it and reads
it. The duty looks again every 30 seconds (`takeUp()`): a run whose watcher is
over, or leaving (alive, but no longer working the effects, so its tails have
stopped), becomes the duty's to read; a start whose watcher ended before it
launched (a restart that lands between the take and the launch) is started
again, given what the session was told, and reported. A session whose provider
never began a thread starts its next run as a first run, given everything it was
told.

<a id="how-the-child-process-is-started"></a>

The package does not reap child processes.

## Logs and transcript storage

<a id="the-log-file-and-the-transcript"></a>

Standard output is stored in the process directory as `<session-eid>.out`, and
`@yaks/session`'s importer reads it into the transcript: each recognized line
becomes entries with `lines{file, start}` (@yaks/file), tool calls and their
results included. The file's `transcript.consumed` (@yaks/session) is the
durable read position, so monitoring resumes after a restart where it stopped. A
pass that fails (a store locked past its busy timeout) is reported, and the next
takes the log up where the transcript stands. Unrecognized and invalid JSON
lines remain in the file and are not entries.

After process exit and final log import, the follower appends its own `stop`
entry as a final import receipt, even if the provider already printed a stop. A
nonzero exit is recorded with that entry, its text naming the cause: the exit
code or the signal it names, a wrapper killed before it wrote a code, or one
that never reported a pid, then the last line the provider wrote on stderr. A
run nobody asked to stop that ends any way but cleanly is reported.

<a id="carrying-on"></a>

A request written after a run ended (an input carrying `using`) starts the next
run on the provider's own thread (`claude --resume`, `codex exec resume`, named
by the `session.id` the provider gave), given everything said to the session
since its last run. A request written while a run is going starts the next run
when that one ends. A run that ends cleanly while the task it holds waits on a
dependency is **parked**: it keeps its claim, its checkout and its log, and the
dependency finishing asks for its next run through `@yaks/session`'s
`session_wake`; a dependency that finished while it ran is told as it ends.
`session_spawn` on a task such a run is parked on, or whose run a wake has asked
for or started (even with its claim let go since), starts nothing: that run gets
the instruction on its own provider, and the answer says so. A peek or wait at a
parked run says it is parked and on what. Every other run's files are taken back
when it ends, and its checkout once its work is landed. Writing `stop` on the
session entity requests termination: SIGTERM to the process group, then SIGKILL
after the configured grace period. A `stop` on an entry only ends the
transcript.

<a id="stopping-a-run"></a>

A provider's tool calls arrive held by the session (`execution{state, by}`):
they already ran in the agent process, and the host's tool runner leaves a call
somebody else holds alone.

<a id="what-an-adapter-is"></a>

An adapter contains a CLI's command line and the `@yaks/session` reader that
says what each output line means. Providers and the models they serve remain
graph entities, so adding a model does not require a package release. The plan
limits a run's stream reports are kept as readings of the provider row that ran,
whichever CLI it speaks, and a limit on one model as the reading of the model
the run asked.

<a id="the-stand-in"></a>

## The stand-in provider

`standin.ts` is a program that takes claude's command line, prints a recorded
stream and exits as the recording ended. A provider row makes it a provider:

```jsonc
{
  "provider": {
    "name": "standin",
    "transport": "process",
    "api": "claude",
    "command": "/srv/repo/packages/spawn/standin.ts",
    "recorded": true
  }
}
```

The model a run asks for names the recording, so the row serves one model per
ending:

| model     | the run                                       | exit |
| --------- | --------------------------------------------- | ---- |
| `clean`   | answers and ends                              | 0    |
| `limit`   | is refused by its plan's limit (`rate_limit`) | 1    |
| `refusal` | is refused by the API for another reason      | 1    |
| `crash`   | is killed mid-turn, saying why on stderr      | 137  |

```sh
yak session spawn T-123 --provider standin --model limit --wait
```

A run of it takes every step a live run does (the launch, the log, the reader,
the ending) and spends nothing, so a change to how a run ends is seen live
without waiting for a plan to run out. `recorded` marks the row as playing
recordings: its ending is written on the session as any run's is, and no failure
is reported to the tracker, since the run ended as it was chosen to; and the
plan readings in its stream are kept of no plan, since a recording read none.
The package's tests ask for the same rows, over a launch that plays the program
in place, unmarked where a test checks what a claude run's ending tells.

An adapter also names the instruction file its provider reads at the root of its
checkout (`CLAUDE.md`, `AGENTS.md`). Before launching, `start` reads that file
in the run's checkout and asks `@yaks/persona`'s `owed` what the run is still
owed of the persona its repository carries. A persona the file does not already
say goes to the provider through its own flag (claude's
`--append-system-prompt`, codex's `developer_instructions`), and is snapshotted
into the transcript as a `prompt` entry (`@yaks/context`). Codex is also told to
read `AGENTS.md` whole, since by default it reads only the first 32 KiB.

## CLI and tool use

<a id="the-session-tools"></a>

```sh
yak session spawn T-37667 --provider claude --model opus --effort high --wait
yak session spawn T-37667 --provider claude --persona N-4568
yak session stop S-4211
yak session wait S-4211 --timeout 45m
yak session peek S-4211 -n 20
```

The MCP names are `session_spawn`, `session_stop`, `session_wait`, and
`session_peek`. `spawn` creates the session, first entry, and claim on the task.
It calls `graph.apply()` itself because the post-commit effect must start the
process before `--wait` can monitor it. `wait` polls the graph. A requested
managed run ends after both process exit and final log import, even if its
provider already printed a `stop`; a session without a process ends when its
transcript reaches `stopped` or `failed`. It reports the brief and exit code,
and reaching its timeout leaves the run active. `stop` writes a stop entry for a
native transcript, or a stop request on a managed session entity; the process
receives SIGTERM, then SIGKILL if it stays up. `peek` renders recent entries
from the graph.

## Configuration

```jsonc
{
  "plugins": [
    "@yaks/session",
    "@yaks/process",
    "@yaks/model",
    {
      "use": "@yaks/spawn",
      "with": {
        "cwd": "/srv/repo",
        "worktrees": "/srv/runs",
        "poll": 250,
        "mcp": { "tasks": "http://localhost:5173/mcp" },
        "without": { "claude": ["claude.ai Google Drive", "railway"] }
      }
    }
  ]
}
```

`cwd` is the source checkout. With `worktrees` set, each CLI run gets
`/srv/runs/<session-eid>` on branch `session-<session-eid>`, cut from the source
repository's local `main`. Uncommitted source changes stay in the source
checkout.

`mcp` names the MCP servers each run is connected to, by name to URL. The launch
configures each one through the provider's own flags (claude's `--mcp-config`,
codex's `-c mcp_servers.<name>`), replacing a server of that name in the
person's own config, and with an `x-via` header naming the run's session. The
door resolves that header (@yaks/session `authenticate`), so what the agent
writes is stamped `by` its actor and `via` its session from its first call, with
nothing asked of the agent.

`without` names the MCP servers of a provider's own configuration its runs go
without, by the provider's name and then the names that provider lists them
under (`claude mcp list`, `codex mcp list`). A provider's CLI connects every
server its configuration and its account name, and each one's tools cost every
run context whether it calls them or not. Claude is given the names as settings
for the run (`--settings` with `deniedMcpServers`) and never connects them, so
neither their tools nor their instructions reach the model. Codex is given
`-c mcp_servers.<name>.enabled=false`, which must name a server its config has.
The person's own sessions and configuration are untouched.

Effects also accept process-file `dir`, polling interval `poll`, and kill
`grace`. Tools accept `poll`, a human-readable default `timeout` such as `45m`,
and the number of `lines` shown by `peek`.

Custom adapters are functions and cannot be represented in JSON configuration:

```ts ignore
import { adapters } from '@yaks/spawn'
import { spawning } from '@yaks/spawn/effects'
import { adopting } from '@yaks/spawn/service'

export const effects = spawning({ adapters: { ...adapters, mine } })
export const service = adopting({ adapters: { ...adapters, mine } })
```

## Exports

The main module exports the built-in `claude` and `codex` adapters, the
`adapters` table, adapter types, and the lower-level `asked()`, `follow()`,
`start()`, `resume()`, `takeUp()`, and `down()` functions. Additional entry
points are:

- `@yaks/spawn/vocab`: `spawnDoc` and `docs`;
- `@yaks/spawn/effects`: `effects`, `spawning()`, and effect configuration;
- `@yaks/spawn/service`: `service` and `adopting()`, the duty that resumes runs
  after a restart;
- `@yaks/spawn/tools`: `runs()`, duration parsing, and brief formatting.

The launcher requires Linux, `setsid`, and a systemd user manager.
