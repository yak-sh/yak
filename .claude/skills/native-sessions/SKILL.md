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

**Not in use.** The owner has banned starting or resuming graph-native sessions
until the effects and graph speed work on T-95308 is fixed (C-121250). Delegate
to Claude agents instead; this skill stays as the reference for when the ban
lifts.

A native session is a transcript in the graph that @yaks/harness runs: our own
agent loop. `yak session new` writes the session and its first input, then only
waits; the runner works the transcript wherever the effects role is served
(packages/harness/runs.ts and effects.ts). Every model turn and tool call lands
as an entry, so the graph is the record of everything it did, and killing the
CLI that started it stops nothing.

Commands and files target workspaces, not a session's location. A session's
`home{workspace, cwd}` is a convenience default, not permissions. A workspace
records a directory on a real computer or sandbox; `machine{address}` records
only the real computer. With no workspace, the first file or command call records a sandbox intention
through the host's explicitly configured adapter. Missing configuration refuses
rather than creating a process directory. The host's current directory is never
silently lent to a session (packages/harness/session_machines.ts).

Its persona comes from graph context: `--work <task-or-project>` admits the
work's common persona and records its project; `--persona <id-or-name>` selects
an explicit persona. A checkout can supply its projected instructions too.
Before each ask, an exact tool offer containing `skill_read` receives graph
skill titles and descriptions, scoped to the session's project repository when
known. `skill_read` loads the selected graph instructions. Neither discovery
nor loading scans files or provisions a machine. The persona skill mirror
synchronizes repository skill files separately (`{skills: true}`).

Ordinary file reads are not automatically model instructions; recorded prompt
snapshots keep their original content. An explicitly named machine admits its
ancestor AGENTS.md files at session opening (packages/harness/instructions.ts),
through Machine commands and reads. Missing instruction projections need graph
context from `--work` or `--persona`, rather than a silent empty persona.

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
yak session new --work T-<n> --prompt @<scratchpad>/brief.md \
  --provider openai --model <model-name> --effort high
```

Code work names an existing workspace or uses an explicitly configured sandbox
adapter. A sandbox's `from` is initial provenance, not a backup of later edits.
See packages/machine/README.md for execution and packages/sandbox/README.md for
provisioning. A missing or pending placement is not the graph host's disk.

```sh
yak session new --prompt @<scratchpad>/brief.md --workspace <workspace-id> --cwd <directory-in-that-filesystem> --provider openai --model <model-name> --effort high
```

`--workspace` names a workspace record, not a path. An explicit workspace admits
its ancestor instruction files through its own commands and reads. A model-only opening requires no workspace. The first file or command call
requires a configured default sandbox adapter and records its pending intention.

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
  subagents"). `spawn({task})` requests a separate sandbox intention.
  Prompt children and forks share the parent's workspace unless given `workspace`
  or `sandbox: {provider?, from?, image?}`. Children writing side by side usually
  want separate sandboxes (M-3715); the brief carries how their commits reach the
  graph and land. Dirty files are not initial sandbox provenance.

## While it runs

- **Its S-id.** The CLI prints only the final reply. `yak session list` lists
  sessions, each with its status; once it claims the task, `yak graph show
  T-<n>` names it too. `yak graph show S-<n>` shows its home workspace,
  dispatch and parent. Its command directory may not be recorded until a
  provider lends the machine.
- **Watching**: `yak session peek S-<n>` shows its newest entries and status.
- **Saying more**: `yak session send S-<n> '<text>'` adds an input it reads on
  its next turn and waits for it to settle, so run it in the background too.
  When it's the owner's words, relay them verbatim.
- **A long session drifts.** What it reads most is its own output and its
  children's reports, and compaction keeps the newest lines verbatim, so any
  quirk in them compounds: by the end of a two-day run on T-65275 its comments
  ran words together and its children's did first. Give one session one slice
  of work. For the next slice, start a fresh session from a brief you write,
  saying what is true in your own words rather than quoting its reports,
  instead of sending more into the old one.
- **Waiting for the work, not the quiet.** `yak session new` and
  `yak session wait` return when the session's own transcript settles
  (packages/session/status.ts reads its transcript, never its children's). A
  root that handed work to children and ended its turn reads `settled` while
  they work, and wakes when they report. So wait on the task, and on the
  session failing, as a background shell command:

  ```sh
  until yak graph query '(.entity.eid=T-<n> .task.status=done,cancelled) | (.entity.eid=S-<n> .session.status=failed,stopped) .count' | grep -q '"count":1'; do sleep 60; done
  ```

- **Stopping**: `yak session stop S-<n>` stops native sessions as well as
  managed spawns. A native session reads `stopped` and admits no more model
  turns or tool calls; a step already in flight can finish recording its
  answer without reopening the transcript. No workspace is disposed when that step finishes. New input (`yak session send`) resumes it.
- **Restarting**: `yak restart` is the agent's restart door. It waits for a new
  independent `yak-work@` worker and a new `yak-web@` web to be ready, then
  queues the old units' stops; it doesn't sit in a shell waiting for shutdown.
  The web runs `yak serve --no-duties`, so web and session work are separate,
  and the new web shares the port with the old, so no request is refused. A
  draining worker takes no new step and lets its step in flight finish, a model
  request or a tool call that may run for minutes, and the journal says which
  runs it's waiting on (@yaks/process/wind, packages/cli/drain.ts). Its unit
  kills it after 15 minutes (`TimeoutStopSec`), and a second interrupt forces
  shutdown sooner; either may cut off a step or an external action, so it
  isn't lossless. An interrupted step is reported to the session
  (packages/session/react.ts).
- **Afterwards**, files and commands remain at their original workspace.
  Changing a session's default or stopping its transcript does not move files,
  stop processes or dispose resources. Process recovery follows
  `process.workspace`, never the caller's current default. Sandbox disposal is
  explicit; a released sandbox is not silently replaced on resume.

When this skill is wrong or missing something, fix it in the same change.
