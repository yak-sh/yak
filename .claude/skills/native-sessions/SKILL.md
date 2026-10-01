---
name: native-sessions
description: >
  Starting and running a graph-native session in ~/code/tasks: one our own
  agent loop runs (@yaks/harness, the native harness), started with `yak
  session new` from the worktree it should work in, then finding its S-id,
  watching it, saying more to it, waiting for its work and knowing what stops
  it. Use it whenever you are asked for a "native", "graph-native" or
  "harness" session, to run a GPT model (Sol, Astra, gpt-6.1-sol) on a task
  or "in the harness", or to hand work to a model other than Claude, and
  whenever you are about to run `yak session new` or `yak session send`, even
  if the request only says "have sol do it". Load it too before reaching for
  the Codex plugin in Claude Code (the `codex:codex-rescue` agent type,
  `/codex:rescue`, the other `codex:` skills) or `yak session spawn --provider
  codex`: neither is a native session. What the brief says is `agent-briefs`.
---

# Native sessions

A native session is a transcript in the graph that @yaks/harness runs. `yak
session new` writes the session and its first input, then only waits: the
runner works the transcript in whichever process serves the effects role,
`yak serve` on this box (packages/harness/runs.ts). Each model turn and tool
call lands as an entry, so the graph is the record of everything it did, and
killing the CLI that started it stops nothing. Its shell commands run on this
machine with `TASKS_SESSION` set to the session (packages/session/who.ts), so
its own `yak claim take` and `yak comment new` act as it. It carries the
persona from the graph (M-36709) but not the skills in .claude/skills
(T-61611).

A request naming a GPT model pulls toward whatever has "codex" in its name.
That door is wrong. The native harness's `openai` provider already serves
those models through the OpenAI connection's ChatGPT sign-in, and its
transcript lives in the graph. Not native:

- `yak session spawn --provider claude|codex`: an outside CLI agent (Claude
  Code, the Codex CLI) on a task, its output imported as a transcript
  (M-36709).
- The Codex plugin in Claude Code: the `codex:codex-rescue` agent type,
  `/codex:rescue`, `codex:setup` and the plugin's other skills. They drive the
  Codex CLI from your conversation, outside the harness.

## Starting one

1. The task is the spec (`agent-briefs`). Write the brief to a file in your
   scratchpad, outside the worktree, so the session never commits it.
2. Cut its worktree:
   `git worktree add ~/.yak/worktrees/<name> -b <branch> main`.
   A root session's checkout is the directory it was started in
   (`home{worktree, cwd}`, packages/harness/workspace.ts `homeAt`). Started
   from the main checkout, it works in main.
3. From that worktree, as a background shell command, since it returns only
   when the session settles:

   ```sh
   cd ~/.yak/worktrees/<name> && yak session new --prompt @<scratchpad>/brief.md --provider openai --model gpt-6.1-sol --effort high
   ```

   `@path` reads any argument's value from a file, and `-` from stdin
   (packages/cli/args.ts `inflate`). Without flags it runs `openai` and
   `gpt-6-astra`.

`yak model list` is the OpenAI endpoint's catalog, and a model missing from it
may still answer: gpt-6.1-sol is unlisted and runs. A one-line probe settles
it in seconds:
`yak session new "Reply with only: ok" --provider openai --model <name> --effort low`.

## What its brief adds

`agent-briefs` says what a brief carries. A native session needs three more
things:

- **The skills by path.** It cannot load them, so name each SKILL.md its work
  needs and tell it to read them first.
- **Nobody is at its prompt.** When only Jeff can decide something, it says so
  on the task and stops there, rather than guessing or waiting.
- **How its children land**, when it may delegate. The harness gives it
  `spawn`, `fork` and `wait` tools (packages/harness/README.md, "Forks and
  subagents"). `spawn({task})` cuts each child a worktree of its own from the
  parent's committed HEAD, on branch `task-<child>`; `spawn({prompt})` and
  `fork` share the parent's checkout unless given `worktree`. Children that
  write code in parallel each need a checkout of their own (M-3715), and each
  lands its own branch.

## While it runs

- **Its S-id.** The CLI prints only the final reply. `yak graph query '.session
  .home.cwd=<worktree path>'` lists the session started there and the children
  sharing its checkout, each with its status; once it claims the task, `yak
  graph show T-<n>` names it too.
- **Watching**: `yak session peek S-<n>` (its newest entries and status) and
  `yak graph show S-<n>` (its home, dispatch and parent).
- **Saying more**: `yak session send S-<n> '<text>'` adds an input it reads on
  its next turn, and waits for it to settle, so it runs in the background too.
  Relay Jeff's words verbatim.
- **Waiting for the work.** `yak session new` and `yak session wait` return
  when the session's own transcript settles (packages/session/status.ts reads
  its transcript, never its children's). A root that handed work to children
  and ended its turn reads `settled` while they work, and wakes when they
  report. So wait on the task, and on the session failing, as a background
  shell command:

  ```sh
  until yak graph query '(.entity.eid=T-<n> .task.status=done,cancelled) | (.entity.eid=S-<n> .session.status=failed,stopped) .count' | grep -q '"count":1'; do sleep 60; done
  ```

- **Stopping**: there is no stop for a native session yet. `yak session stop`
  stops managed spawns and refuses this one as "not a managed session"
  (T-42246).
- **A restart of `yak serve`** gives effects in flight 30 s
  (packages/cli/signal.ts `GRACE`; T-61776 changes that), then cuts them. When
  it is back, the session picks up where it was, told that its step was
  interrupted (packages/session/react.ts).
- **Afterwards**, leave the worktree. When `yak serve` next starts, a
  worktree under ~/.yak/worktrees that is clean and landed, and that no running
  session uses, is removed with its branch (packages/harness/worktrees.ts
  `sweep`).

When this skill is wrong or missing something, fix it in the same change.
