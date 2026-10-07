---
name: native-sessions
description: >
  Starting and running a graph-native session in ~/code/tasks: one our own
  agent loop runs (@yaks/harness, the native harness), started with `yak
  session new` from the worktree it should work in, then finding its S-id,
  watching it, saying more to it, waiting for its work and knowing what stops
  it. Use it whenever you are asked for a "native", "graph-native" or
  "harness" session, or for a model to work "in the harness", and whenever you
  are about to run `yak session new` or `yak session send`. `yak session spawn`
  and the Codex plugin in Claude Code (`codex:codex-rescue`, `/codex:rescue`)
  run outside agents, not native sessions. What the brief says is
  `agent-briefs`.
---

# Native sessions

A native session is a transcript in the graph that @yaks/harness runs: our own
agent loop. `yak session new` writes the session and its first input, then only
waits; the runner works the transcript in whichever process serves the effects
role, `yak work` on this box (packages/harness/runs.ts). Every model turn and
tool call lands as an entry, so the graph is the record of everything it did,
and killing the CLI that started it stops nothing. Its shell commands run on
this machine with `TASKS_SESSION` set to the session (packages/session/who.ts),
so its own `yak claim take` and `yak comment new` act as it. It carries the
persona from the graph (M-36709) and, before each ask, a fresh catalogue of the
repository's skill titles and descriptions; when one matches its work, it calls
`skill_read` by title, and only that call loads the body. Its read-only view
follows its own `home{worktree, cwd}`, local edits, additions and deletions
included, without importing them into the graph.

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
  (M-36709).
- **The Codex plugin in Claude Code**: the `codex:codex-rescue` agent type,
  `/codex:rescue`, `codex:setup` and the plugin's other skills. They drive the
  Codex CLI from your conversation, outside the harness.

A native session, harness session or graph-native session is `yak session new`.

## Starting one

1. The task is the spec (`agent-briefs`). Write the brief to a file in your
   scratchpad, outside the worktree, so the session never commits it.
2. Cut its worktree:
   `git worktree add ~/.yak/worktrees/<name> -b <branch> main`.
   A root session's checkout is the directory it was started in
   (`home{worktree, cwd}`, packages/harness/workspace.ts `homeAt`), so one
   started from the main checkout works in main.
3. Start it from that worktree, as a background shell command, since it returns
   only when the session settles:

   ```sh
   cd ~/.yak/worktrees/<name> && yak session new --prompt @<scratchpad>/brief.md --provider openai --model gpt-6.1-sol --effort high
   ```

   `@path` reads any argument's value from a file, and `-` from stdin
   (packages/cli/args.ts `inflate`). Without flags it runs the `openai`
   provider's own `using` model, a row in the graph
   (packages/harness/model_selection.ts `defaultUsing`), today `gpt-6-astra`.

`yak model list` is the OpenAI endpoint's catalog, and a model missing from it
may still answer: gpt-6.1-sol is unlisted and runs. A one-line probe settles it:
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
  subagents"). `spawn({task})` cuts each child a worktree of its own from the
  parent's committed HEAD, on branch `task-<child>`; `spawn({prompt})` and
  `fork` share the parent's checkout unless given `worktree`. Children writing
  code side by side each want a checkout of their own (M-3715), and each lands
  its own branch.

## While it runs

- **Its S-id.** The CLI prints only the final reply. `yak graph query '.session
  .home.cwd=<worktree path>'` lists the session started there and the children
  sharing its checkout, each with its status; once it claims the task, `yak
  graph show T-<n>` names it too.
- **Watching**: `yak session peek S-<n>` (its newest entries and status) and
  `yak graph show S-<n>` (its home, dispatch and parent).
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

- **Stopping**: there is no stop for a native session yet. `yak session stop`
  stops managed spawns and refuses this one as "not a managed session"
  (T-42246).
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
- **Afterwards**, leave the worktree be. Every five minutes the harness's
  maintenance service, on whichever worker holds its lease, removes each
  worktree under ~/.yak/worktrees that is clean, has committed work landed on main, and is used by no
  running session or local process (cwd or open files), branch and all (packages/harness/service.ts,
  packages/harness/worktrees.ts `sweep`).

When this skill is wrong or missing something, fix it in the same change.
