---
name: native-sessions
description: >
  Starting and running a graph-native session in ~/code/tasks: one our own
  agent loop runs (@yaks/harness, the native harness), started with `yak
  session new`, with a provider-backed machine when it needs commands or
  files; then finding its S-id, watching it, saying more to it, waiting for
  its work and knowing what stops it. Use it whenever you are asked for a
  "native", "graph-native" or "harness" session, or for a model to work "in
  the harness", and whenever you are about to run `yak session new` or
  `yak session send`. `yak session spawn` and the Codex plugin in Claude Code
  (`codex:codex-rescue`, `/codex:rescue`) run outside agents, not native
  sessions. What the brief says is `agent-briefs`.
---

# Native sessions

A native session is a transcript in the graph that @yaks/harness runs: our own
agent loop. `yak session new` writes the session and its first input, then only
waits; the runner works the transcript wherever the effects role is served
(packages/harness/runs.ts and effects.ts). Every model turn and tool call lands
as an entry, so the graph is the record of everything it did, and killing the
CLI that started it stops nothing.

Its commands and files belong to a machine, not to the process serving its
graph. `home{machine, cwd}` names that machine and an optional command directory
(packages/harness/session_machines.ts). With no machine named, its first shell
or file call requests a sandbox from the host's default provider. Starting a
session or asking a model a question needs no machine. The host's current
directory is not the session's home, and starting from a checkout does not lend
that checkout to the session.

It carries its chosen persona from the graph (M-36709). Before each ask, an
exact tool offer containing `skill_read` gets skill titles and descriptions:
from the graph before a machine is running, and from the machine's files once
it is running. When a description matches its work, it calls `skill_read`, and
only that call loads the body. Machine-file catalogues include edits, additions
and deletions without importing them into the graph. Ordinary file reads are
not automatically model instructions; recorded prompt snapshots keep their
original content. An explicitly named machine admits its ancestor AGENTS.md
files at session opening (packages/harness/instructions.ts), through Machine
commands and reads, never the host's disk.

Think of it as a colleague working in the next room whose every word is
written on the wall. You don't sit with it: you read the wall, slip it a note,
and wait for the work, not for the room to go quiet. And nobody stands at its
door to answer questions, so what it needs to decide on its own has to be in
the brief. `agent-briefs` is the larger pattern this one lives in: what any
brief carries, and how a report is read when it comes back.

## What it isn't

Two other things here run a model on a task, and the word "codex" in them makes
them easy to mistake for this:

- **`yak session spawn --provider claude|codex`**: an outside CLI agent (Claude
  Code, the Codex CLI) on a task, its output imported as a transcript
  (M-36709). Moving those agents into machines is T-66427.
- **The Codex plugin in Claude Code**: the `codex:codex-rescue` agent type,
  `/codex:rescue`, `codex:setup` and the plugin's other skills. They drive the
  Codex CLI from your conversation, outside the harness.

A native session, harness session or graph-native session is `yak session new`.

## Starting one

The task is the spec (`agent-briefs`). Write the brief to a file in your
scratchpad, outside code you expect the session to commit. Pass it with
`--prompt @<scratchpad>/brief.md`; `@path` reads any argument's value from a file,
and `-` from stdin (packages/cli/args.ts `inflate`). Run the command in the
background because it returns only when the session settles:

```sh
yak session new --prompt @<scratchpad>/brief.md --provider openai --model <model-name> --effort high
```

Without a machine, a provider may give it an empty filesystem. Code work needs
a machine prepared from a commit in the graph, or an explicitly attached
machine that already carries the code. `machine{provider, address, from, image,
state}` is @yaks/machine's record: `from` is a graph commit, not a host path;
`address` is an existing-machine address its provider understands. See
packages/machine/README.md and packages/harness/README.md, "Session machines".
The graph's commit-receiving landing door is T-66426; a commit made inside a
machine is not automatically a commit the graph holds.

For substrate work that really needs the existing box or checkout, name its
configured machine explicitly, rather than letting where you happen to start
the CLI choose it:

```sh
yak session new --prompt @<scratchpad>/brief.md --machine <machine-id> --cwd <directory-on-that-machine> --provider openai --model <model-name> --effort high
```

`--machine` names a machine record, not a path. `--cwd` is on that machine, not
on the graph host. The provider's default directory is used when none is
recorded. A machine is no more the graph host's by right than any other machine
(D-66416).

The process provider (T-66421, packages/process/machine.ts) gives sandboxes their
own directories and can attach an existing directory. It is not a security
boundary and supplies no CPU or memory limit: bash and rooted paths can reach
that filesystem. Provider isolation, resource limits and a remote machine's
narrowed graph grant are separate capabilities in D-66416, not promises made by
the native harness. Check what the configured provider lends before treating a
machine as an isolated environment. A provider that cannot prepare the graph
commit or boot an image refuses it rather than silently starting something
else.

Without model flags, selection comes from the provider's `using` row
(packages/harness/model_selection.ts). `yak model list` is the configured
endpoint's catalogue; a one-line probe settles whether an unlisted name runs:
`yak session new "Reply with only: ok" --provider openai --model <name> --effort low`.

## What its brief adds

It finds its skills from their descriptions, so the brief needn't paste their
bodies or name their files. What it can't find anywhere is two things:

- **Nobody is at its prompt.** When something truly needs the owner (spending,
  an irreversible act, a preference he alone holds), it says so on the task and
  stops there rather than guessing or waiting. Everything else is its own to
  carry. A session told it may stop for the owner reaches for that door at the
  first hard thing: a failing check or a bug it found turns into "owner
  decision required", and every session waiting on it stalls. So the brief
  tells it that a bug it meets is its to fix, and that a check it was given is
  a check, not a gate the owner must waive.
- **How its children land**, when it may delegate. The harness gives it
  `spawn`, `fork` and `wait` tools (packages/harness/README.md, "Forks and
  subagents"). `spawn({task})` records a separate machine request from the
  parent machine's recorded `from` commit, or an empty machine if none is
  recorded. `spawn({prompt})` and `fork` share the parent's machine unless
  given `machine`. A caller can name an existing machine id or request one
  with `machine: {provider?, from?, image?}`. Children writing code side by side
  want machines of their own (M-3715); the brief carries how their commits
  reach the graph and land. Dirty files and unreceived commits on the parent's
  machine are not the task child's base.

## While it runs

- **Its S-id.** The CLI prints only the final reply. `yak session list` lists
  sessions, each with its status; once it claims the task, `yak graph show
  T-<n>` names it too. `yak graph show S-<n>` shows its home, machine reference,
  dispatch and parent. Its command directory may not be recorded until a
  provider lends the machine.
- **Watching**: `yak session peek S-<n>` shows its newest entries and status.
- **Saying more**: `yak session send S-<n> '<text>'` adds an input it reads on
  its next turn and waits for it to settle, so run it in the background too.
  When it's the owner's words, relay them verbatim.
- **Waiting for the work, not the quiet.** `yak session new` and
  `yak session wait` return when the session's own transcript settles
  (packages/session/status.ts reads its transcript, never its children's). A
  root that handed work to children and ended its turn reads `settled` while
  they work, and wakes when they report. So wait on the task, and on the
  session failing, as a background shell command:

  ```sh
  until yak graph query '(.entity.eid=T-<n> .task.status=done,cancelled) | (.entity.eid=S-<n> .session.status=failed,stopped) .count' | grep -q '"count":1'; do sleep 60; done
  ```

- **Stopping**: there is no CLI stop for a native session yet. `yak session
  stop` stops managed spawns and refuses a native one as "not a managed
  session" (T-42246).
- **Restarting**: `yak restart` is the agent's restart door. It waits for a new
  independent `yak-work@` worker to be ready, then queues the old workers'
  graceful drain and the web restart; it doesn't sit in a shell waiting for
  shutdown. `yak.service` runs `yak serve --no-duties`, so web and session
  work are separate. A draining worker takes no new step and lets its step in
  flight finish, a model request or a tool call that may run for minutes, and
  the journal says which runs it's waiting on (@yaks/process/wind,
  packages/cli/drain.ts). A second interrupt forces shutdown and may cut off a
  step or an external action, so it isn't lossless. An interrupted step is
  reported to the session (packages/session/react.ts).
- **Afterwards**, ordinary settled turns keep their machine because the
  session can receive more input. Terminal completion or stopping asks the
  provider to release it; shared machines remain lent while another unfinished
  session uses them. A released machine can be requested or attached again on
  resumed work. Detaching an explicitly attached machine does not destroy its
  files. Provider lifecycle calls are retryable, with their state in the graph;
  there is no harness worktree sweep or host-disk maintenance service.

When this skill is wrong or missing something, fix it in the same change.
