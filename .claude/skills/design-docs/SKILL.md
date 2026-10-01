---
name: design-docs
description: >
  Write, revise, file and decide a design (a D- entity) for the owner in the yaks
  repo: a proposal he reads before anything is built, with where things live,
  components and their properties, open questions and a task tree. Use it
  whenever you are asked to pitch, propose, draft, design, "write up" or "think
  through" a change bigger than a bug fix; when a change moves code between
  packages or adds a package, a vocabulary keyword or a worker; when the owner
  answers a design's open questions and it needs revising, deciding
  (`yak design decide`) or turning into tasks; or when an agent's draft needs
  reviewing before it goes on a D- entity. Not for a bug fix or a small feature,
  which are just done. How each proposed component is shaped is `vocabulary`,
  and making and wiring a package is `packages-and-plugins`; this one is the
  document around them.
---

# Writing a design for the owner

A design is the graph's record of a proposed change (`design{}` + `doc{title,
body}` + `proposed{}`), filed before the work and decided by the owner. The repo
documents what is; the design holds what is proposed. It exists so the owner can
change the shape while changing it is still cheap.

## What the owner reads it for

- **Where things live** (M-38025). Inside a package, mess is cheap to fix
  later; the boundaries between packages are what he decides. Every design has
  a section naming each package or worker it touches or adds, what each owns,
  what it offers others (verbs in words, not types), and what moves. Existing
  packages first; a new package only where none owns the idea.
- **What is in a component** (M-59030). He judges a component by its
  properties, so write every one as `comp{prop, prop, …}`, never the name
  alone, in the design and in what you tell him about it.
- **His own words** (M-31946). Quote him verbatim at the end, every message
  that shaped the design, with the date. Your summary of him is strictly less
  than what he said.
- **Your recommendation.** Each open question carries the option you would
  pick and why. A question that any reasonable reader would answer the same
  way is a decision, not a question (M-4492).

## The pulls that make designs wrong

You produce the likely shape of a system as fluently as its true shape, so a
design drifts unless you check it against the code.

- **Today's behavior read as the requirement.** If the current code does X,
  you will write "X" into the design as if the owner asked for it. Before a
  constraint goes in, find who asked for it. If nobody did, it's a question,
  not a requirement.
- **Adding beside instead of replacing.** A better shape deletes the old one
  in the same change and migrates the data (M-17871). Say what goes.
- **Coining a word.** Grep what the code already calls a thing before naming
  it (M-12915). A new name is flagged as new.
- **Stuffing into the nearest package.** That's the boundary the owner cares about.
- **Ceremony.** A design that grows gates, approval steps or tests of agent
  conduct is the pattern M-31946 and M-37840 purged.
- **Claims without sources.** Every "X works like Y" cites a file and line, a
  commit or a measurement, or is labelled a guess (M-37958).

## Shape of the body

1. A gist: what changes and why, in a short paragraph.
2. The model: the components (`comp{…}`), how they behave, how it composes.
3. Where things live: per package or worker, what it gains, offers and loses.
4. Migration, when stored data changes: one shape after, proven on a copy, never
   taking a yaks app down (the owner's standing ask; the `data-migration` skill).
5. Open questions, each with a recommendation.
6. A task tree (see below), once the shape is settled.
7. The owner's words, verbatim, dated.

Plain prose, no dates or history in the model sections; provenance lives in
the commits and the quotes.

## Filing it

Draft in a scratch file, then file the body from it, since bodies are long:

```sh
yak design new "<what it proposes, in one line>" @/path/to/body.md --project P-19
```

A title or argument starting with `@` is read as a file path (the @file
door), so `yak task new "@yaks/ui …"` fails with "No such file or directory".
Phrase the title so it doesn't start with `@` ("The @yaks/ui style guide …").

Revise the body by patching it, never by minting a second design:

```sh
python3 -c "import json; json.dump([{'entity':{'eid':'D-…'},'doc':{'body':open('body.md').read()}}], open('change.json','w'))"
yak graph apply --change @change.json
```

When the owner answers questions, comment his words verbatim on the design
(`yak comment new D-… '<his words>'`), fold the answers into a "Decided"
section of the body, and drop what he rejected.

When his comment reshapes the design, the body changes in the same sitting
as your reply, with whatever is still open in its Open questions. You will
want to wait for his answers and revise once; meanwhile the design says the
old shape to every other agent and to the owner, and the new one exists only in a
chat reply that is lost with your context. Open questions are part of a
design, never a reason to leave it stale.

## Deciding it

`yak design decide D-… approved` stamps the caller as the decider: the tool
records the owner only when the owner is calling. So when he approves in conversation,
record the decision as yourself and put his approval verbatim in a comment
beside it. Downstream work you decide on your own (the task tree, follow-ups)
is recorded as yours (M-31958).

## The task tree

One task per thing (M-4492); a body is the irreducible ask plus pointers, never
a restatement of the design (M-14370): "D-…, task tree item 4." is often
enough. File the tree as one change, with `$alias` eids and `requires` edges
from a task to what it needs, dry-run first:

```json
[
  {"entity": {"eid": "$t1"}, "doc": {"title": "…", "body": "D-…, task tree item 1."}, "task": {}, "filed": {"project": "P-19"}},
  {"entity": {"eid": "$t2"}, "doc": {"title": "…", "body": "D-…, task tree item 2."}, "task": {}, "filed": {"project": "P-19"}},
  {"entity": {"eid": "$e1"}, "edge": {"from": "$t2", "to": "$t1"}, "requires": {}}
]
```

```sh
yak graph apply --change @tree.json --check   # see what it would do
yak graph apply --change @tree.json
yak task list '.task .order=-created.at' --limit 20   # read back the ids
```

An edge can point at an existing task by id (`"to": "T-…"`), which is how two
designs' trees depend on each other. A question only the owner can answer is its own
task with `--assignee U-3709`.

## When an agent drafts it

A long design is drafted by an agent into a scratch file; you read it before
the owner does. Check its claims against the code where they decide anything, put
it on the design, and tell the owner the gist with components written out, where
you disagree, and the questions that need him. The rest stays in the design.

When this skill is wrong or missing something, fix it in the same change.
