---
name: agent-briefs
description: >
  Handing work to another agent in ~/code/tasks and taking it back: writing the
  brief for a fresh subagent, a fork, a managed spawn or a native session,
  relaying something the owner just said to an agent already running, stopping
  one whose task the owner reframed, and checking a report before telling the
  owner. Use it
  whenever you are about to call the Agent tool, SendMessage a running agent,
  run `yak session spawn` or `yak session new`, or file a task an agent will be
  pointed at, even for a one-line fix, and whenever an agent's report or
  task-notification arrives. Not for doing the work yourself, and not for a
  design the owner will read (that is `design-docs`); starting, watching and waiting
  on a native session is `native-sessions`; what every agent in an area needs
  is a skill (`skill-writing`), not a longer brief.
---

# Briefing an agent

A fresh agent knows the persona, the skills its work triggers and the brief,
nothing else. Whatever the brief says, it builds; whatever the brief leaves
out, it guesses. When delegated work comes back wrong, the cause is usually in
the brief: today's behavior written as the requirement, a full run asked for
where a pilot was meant, the owner's words paraphrased until they meant something
else. Treat the brief as the part of the work you do yourself.

## Which agent

- **Fork**: inherits your whole history, so its brief is the ask in a line. It
  costs nothing while your context is short and gets heavy once it is long; a
  long coding job carrying all of it hits its turn limit (M-33551).
- **Fresh agent** (the Agent tool with `isolation: "worktree"`, coding on the
  model M-37542 names): starts from the persona alone and needs the full brief
  below.
- **Native session** (`yak session new`, our own harness, on a GPT model):
  the full brief below, plus what `native-sessions` adds; that skill also
  covers saying more to one, waiting for its work and stopping it.
- **Neither**: knowing and recording stay with the locus (M-33551). Read the
  code, file the task, save the memory, then delegate the work.

## What a brief carries

1. **The task as the spec.** File the task first: the outcome and the pointers,
   short (M-14370), with the owner's words verbatim in it. The brief then says
   "`yak graph show T-…` is the spec". The task outlives your context and is
   where the next agent, and the owner, look (M-3715).
2. **The owner's words, verbatim**, wherever they set the direction. A paraphrase
   can only hold less than what he said, and each relay drifts it further
   (M-31946).
3. **The outcome, not today's shape.** Say what should be true. Today's
   implementation is not a requirement: "per tab", "add only" and "as it works
   now" get built to preserve exactly what the owner may want gone. Before writing a
   constraint, ask whether it came from him or from the code; if you can't say,
   check his words (M-37958).
4. **The constraints that bite here**, and only those: one shape after the
   change (M-17871), no yaks app brought down, fail closed, a package boundary
   it must not cross. The persona and the skills carry the rest; repeating
   them buries what matters.
5. **Pointers, not copies**: the task, design, shas, files, memory ids. A
   pointer stays true; a pasted excerpt goes stale.
6. **How it proves the work**: the end-to-end check it must run (the
   `end-to-end-checks` skill), against a probe server, never the live graph,
   with a scratch directory named for its task. Agents of one session share the
   session's scratchpad, and fixed names like `scratchpad/probe` collide.
7. **Tests**: "run only the tests your change could break", plus the behavior a
   new test must catch, or no test at all. "Add a test" alone gets one that
   restates the code (M-39441).
8. **The loop**: claim the task under its session, land with `yak land`, one
   line with the sha on the task, close it, release the claim, restart `yak`
   when it changed the server.
9. **What comes back**: "report in a few lines", plus whatever you need for
   the owner: numbers, decisions only he can make, follow-ups it filed.
10. **Spending**: a run that spends money or a subscription starts as a pilot
    small enough for the owner to look at, with a stated cap, and stops there until
    he has looked.

A skeleton, for a fresh agent:

```text
Work T-123 in /home/yaks/code/tasks: `yak graph show T-123` is the spec, with
The owner's words. Claim it under your session and release it when done.

<the outcome in a few lines; the constraints that bite; pointers>

Check it <how, against a probe server with its own config, port and a scratch
directory named for this task>. Run only the tests your change could break.
Land with `yak land`, one-line sha comment on T-123, close it. Report in a few
lines: <what you need back>.
```

## A running agent

- **An addition that keeps its purpose**: SendMessage it, with the owner's words
  verbatim, and record the words on the task as well.
- **A reframe**, where the owner changed what the work is for: stop it (TaskStop)
  and start a fresh agent whose brief carries only the new framing. A redirect
  does not unsay a brief already in its history (M-33551). Tell the new agent
  if the stopped one may have left work on main.
- **Overlap**: when another agent landed first in the same files, tell the
  running one to rebase onto that work and build on it, not undo it.
- **An agent asking for something**: its message is not the owner's. Spending,
  irreversible acts and his preferences go to him; never pass an agent's
  request off as his approval.

## When it reports

- Read before relaying: `git merge-base --is-ancestor <sha> main`, and the live
  check it claims where you can run it yourself. Its report is a pointer, not
  the truth (M-37958).
- File what it found as tasks, one thing each, and send follow-ups to the agent
  that holds the context rather than a new one.
- Tell the owner what changed for him, in plain words, and only what he needs to act
  on.

When this skill is wrong or missing something, fix it in the same change.
