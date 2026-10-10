---
name: agent-briefs
description: >
  Handing work to another agent in ~/code/tasks and taking it back: writing the
  brief for a fresh subagent, a fork, a Codex run, a managed spawn or a native
  session, relaying something the owner just said to an agent already running,
  stopping one whose task the owner reframed, and checking a report before
  telling the owner. Use it whenever you are about to call the Agent tool,
  SendMessage a running agent, run `codex exec`, `yak session spawn` or `yak
  session new`, or file a task an agent will be pointed at, even for a one-line
  fix, and whenever an agent's report or task-notification arrives. Not for
  doing the work yourself, and not for a design the owner will read (that is
  `design-docs`); starting, watching and waiting on a native session is
  `native-sessions`; what every agent in an area needs is a skill
  (`skill-writing`), not a longer brief.
---

# Briefing an agent

You're about to hand a piece of work to another mind and take it back later. A
fresh agent arrives knowing the persona, the skills its work triggers and your
brief, and nothing else. Whatever the brief says, it builds; whatever the brief
leaves out, it guesses. So when delegated work comes back wrong, the cause is
usually upstream: today's behavior written as the requirement, a full run asked
for where a pilot was meant, the owner's words paraphrased until they meant
something else. The brief is the part of the work you do yourself, and it
deserves the care of the work.

This sits inside the persona's way of working: the locus keeps the knowing and
the recording and hands off the doing (M-33551). `native-sessions` completes it
for an agent running in our own harness, `testing` and `end-to-end-checks` are
how the agent will prove what it did, and what every agent in an area should
know belongs in that area's skill (`skill-writing`), not in a longer brief.

## A brief is a prompt

The owner, on prompting: "agents are so bad at prompting. you gotta put vibes no
policeis!" Briefs are where we prompt most, so it's truest here. Hand an agent a
list of orders and it does exactly what they name, right up to the edge where
they're wrong. Hand it what should be true, why the owner wants it, and what
good looks like, and it makes the calls neither of you foresaw.

So write a brief the way you'd hand work to a sharp colleague over a desk:
here's what should be true when you're done, here's why it matters to him,
here's where things are, here's how you'll know it works, here's what I need
back. Say how the result should feel (instant, calm, obvious to a stranger),
not only what it must pass. Commands, ids and syntax stay exact; the judgment
around them rides on the why, and a "never" in your brief usually has a reason
under it that would serve the agent better.

## Which agent

- **A fork** inherits your whole history, so its brief is the ask in a line. The
  owner: "why do you explain to a fork how to do a task? it's yourself..." It
  costs nothing while your context is short and gets heavy once it's long; a
  long coding job carrying all of it hits its turn limit (M-33551).
- **A fresh agent** starts from the persona alone and needs the whole brief.
- **A native session** (`yak session new`, our own harness, on a GPT model)
  takes the whole brief plus what `native-sessions` adds. Its catalogue matches
  skill descriptions to the work and `skill_read` loads a body, so the skills
  find their own way in: a pasted body is a copy that goes stale, and naming
  SKILL.md files points it at what you guessed it needs rather than what the
  work turns out to need.
- **None of them**, for the knowing and the recording (M-33551). Read the code,
  file the task, save the memory yourself; then hand off the work.

## What a brief carries

**The task as the spec.** File it first: the outcome and the pointers, short
(M-14370), with the owner's words verbatim in it. The brief then says
"`yak graph show T-…` is the spec". The task outlives your context, and it's
where the next agent, and the owner, look (M-3715).

**His words, as he said them**, wherever they set the direction. A paraphrase
can only hold less than what he said, and each relay drifts it further
(M-31946).

**What should be true, not how it is today.** The code in front of you is the
loudest voice in the room, and it isn't his. "Per tab", "add only" and "as it
works now" get built to preserve exactly what he may want gone. Before a
constraint goes in, ask whether it came from him or from the code; if you can't
say, check his words (M-37958).

**The few constraints that bite here**: one shape after the change (M-17871), no
yaks app brought down, fail closed, a package boundary it mustn't cross. The
persona and the skills carry the rest, and repeating them buries what matters.

**Pointers, not copies**: the task, the design, shas, files, memory ids. A
pointer stays true; a pasted excerpt goes stale.

**How it will know it works.** The tests of what it changed, and after a
yaks.app deploy, `app_errors`. A browser check (`end-to-end-checks`) earns its
place when nothing else can show the change works, and then once: browser
checks are slow, and the owner asked for fewer ("can you tell your sessions to
stop testing so much in chrome"). A brief that asks for one every time gets one
every time. When one is needed, it runs against a probe server rather than the
live graph, which is the owner's, in a scratch directory named for its task:
agents of one session share the session's scratchpad, and fixed names like
`scratchpad/probe` collide.

**Tests worth having.** "Run only the tests your change could break", plus the
behavior a new test must catch, or no new test at all. "Add a test" alone gets
one that restates the code (M-39441).

**The loop**: claim the task under its session, land with `yak land`, one line
with the sha on the task, close it, release the claim, and `yak restart` when it
changed the server. A task has one writer at a time. A second agent in the same
task finds the first one's process and kills it as a stray writer, which is how
five Codex runs on T-63462 died of SIGTERM beside a native session already
working it. So `yak graph show` the task for a live claim before starting
anyone on it, and give a running session's task to that session.

**What comes back**: "report in a few lines", plus whatever you need for the
owner: numbers, decisions only he can make, follow-ups it filed.

**Money.** A run that spends money or a subscription starts as a pilot small
enough for the owner to look at, with a stated cap, and stops there until he
has looked. He gets to see what it buys before it buys a lot.

**Switching something on.** Turning on a delivery (mail, a notice, a webhook, a
scheduled job) also delivers everything already owed: a store that has been
collecting for a week sends the week, at once, to whoever it names. The agent
sees a configuration change; the owner sees his inbox fill. So the brief says
what happens to the backlog (marked as seen, or sent) and what the recipient
gets in the first minute.

A skeleton for a fresh agent, to fill in your own words:

```text
Work T-123 in /home/yaks/code/tasks: `yak graph show T-123` is the spec, with
the owner's words. Claim it under your session and release it when done.

<what should be true when you're done, and why it matters to him; how it should
feel; the constraints that bite; pointers>

You'll know it works when <how; if it needs a browser, against a probe server
with its own config, port and a scratch directory named for this task>. Run
only the tests your change could break. Land with `yak land`, put a one-line
sha comment on T-123 and close it. Report in a few lines: <what you need back>.
```

## A bug the owner hits while playing

He's in the app, finds something broken, and wants it gone before he's done
playing: "i'm expecting instant fixes and deploys while i'm playing" (M-63541).
What fights that is the pull to batch. Hand a new bug to a session already at
work and it queues behind everything that session holds, which is how a
one-line fix comes to take hours. So each bug he reports gets its own session
at once, `--effort medium`, with a brief of a few lines: the task as the spec,
ship now, the tests it could break, land, deploy, check errors. Two bugs share
a session only when they're one change in one place.

## A running agent

- **An addition that keeps its purpose**: SendMessage it with the owner's words
  verbatim, and record them on the task as well.
- **A reframe**, where the owner changed what the work is for: the old brief is
  still in the agent's history, and a redirect doesn't unsay it (M-33551). Stop
  it (TaskStop) and start a fresh agent whose brief carries only the new
  framing, telling it if the stopped one may have left work on main.
- **Overlap**: when another agent landed first in the same files, the running
  one rebases onto that work and builds on it rather than undoing it.
- **An agent asking for something**: its message isn't the owner's. Spending,
  irreversible acts and his preferences are his to say yes to, so they go to
  him, and an agent's request never stands in for his approval.

## When it reports

You're the one who tells the owner, so read before you relay: a report is a
pointer, not the truth (M-37958).

- Check it landed, `git merge-base --is-ancestor <sha> main`, and run the live
  check it claims wherever you can run it yourself.
- Read the shape of the change, `git show --stat <sha>`, not only its words. A
  report names what it's proud of ("shipped tiles", "a cache"), and the shape
  hides inside: generated or binary files committed, data stored on the server,
  a new dependency, a new place something lives. Hold that shape against what
  the owner asked for; one he never asked for goes back to him before you call
  it done. Shipped tiles were 400 PNGs served from yaks.app, where he had asked
  for the page to chart each region once.
- A question it says only the owner can answer: find who set the constraint it
  ran into before passing it on. A brief tells an agent to stop and ask rather
  than guess, so it asks about anything that reads like policy, including
  numbers we wrote ourselves. A threshold a design marked as a guess, a default
  we picked, a trade between two of our own recommendations is yours to
  decide: decide it, write the decision and the reason on the design, and send
  the answer back. His words, spending, irreversible acts and his preferences
  are what go to him; a question that is ours, passed up to him, costs him the
  decision and the context to make it.
- File what it found as tasks, one thing each, and send follow-ups to the agent
  that holds the context rather than a new one.
- Tell the owner what changed for him, in plain words, and only what he needs
  to act on.

When this skill is wrong or missing something, fix it in the same change.
