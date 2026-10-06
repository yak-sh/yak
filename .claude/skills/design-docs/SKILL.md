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
documents what is; the design holds what's proposed. It exists so the owner can
change the shape while changing it is still cheap, the way walls on an
architect's drawing move with an eraser and walls on a site move with a crew.
Everything in it serves that: making the shape plain enough for him to see,
true enough to trust, and open where it's still his to choose.

It's the document around parts other skills shape: each component is shaped
in `vocabulary`, each package and its boundary in `packages-and-plugins`, and
moving stored rows is `data-migration`. Once the shape is settled, its task
tree becomes work agents are briefed on (`agent-briefs`).

## What the owner reads it for

- **Where things live** (M-38025). Inside a package, mess is cheap to fix
  later; the boundaries between packages are what he decides. So every design
  has a section naming each package or worker it touches or adds, what each
  owns, what it offers others (verbs in words, not types), and what moves. An
  existing package that owns the idea comes first; a new one is for an idea
  nothing owns yet.
- **What is in a component** (M-59030). He judges a component by its
  properties, so each one is written out as `comp{prop, prop, …}`, in the
  design and in what you tell him about it. The name alone gives him nothing
  to judge.
- **His own words** (M-31946), quoted verbatim at the end: every message that
  shaped the design, with its date. Your summary of him is strictly less than
  what he said.
- **Your recommendation.** Each open question carries the option you'd pick and
  why. A question any reasonable reader would answer the same way is a
  decision, so make it (M-4492).

## The pulls that make designs wrong

You produce the likely shape of a system as fluently as its true shape, so a
design drifts unless it's held against the code. The pulls to feel for:

- **Today's behavior read as the requirement.** If the current code does X, X
  slides into the design as though the owner asked for it. Before a constraint
  goes in, find who asked for it. If nobody did, it's a question, not a
  requirement.
- **Adding beside instead of replacing.** A better shape deletes the old one in
  the same change and migrates the data (M-17871). Say what goes.
- **Coining a word.** Grep what the code already calls a thing before naming it
  (M-12915), and flag a new name as new.
- **Stuffing into the nearest package.** That's the very boundary he cares
  about.
- **Ceremony.** Gates, approval steps and tests of agent conduct are what
  M-31946 and M-37840 purged; a design that grows them is growing the wrong
  thing.
- **Claims without sources.** Every "X works like Y" cites a file and line, a
  commit or a measurement, or says it's a guess (M-37958).

## The shape of the body

In order:

1. A gist: what changes and why, in a short paragraph.
2. The model: the components (`comp{…}`), how they behave, how they compose.
3. Where things live: per package or worker, what it gains, offers and loses.
4. Migration, when stored data changes: one shape after, proven on a copy,
   with no yaks app taken down (his standing ask; `data-migration`).
5. Open questions, each with a recommendation.
6. A task tree (below), once the shape is settled.
7. His words, verbatim and dated.

The model sections are plain prose about what will be, with no dates or
history; provenance lives in the commits and the quotes.

## Filing it

Bodies are long, so draft in a scratch file and file the body from it:

```sh
yak design new "<what it proposes, in one line>" @/path/to/body.md --project P-19
```

Any argument starting with `@` is read as a file path (the @file door), so
`yak task new "@yaks/ui …"` fails with "No such file or directory". Phrase such
a title so it doesn't start with `@` ("The @yaks/ui style guide …").

One proposal is one design, so a revision patches its body rather than minting
a second:

```sh
python3 -c "import json; json.dump([{'entity':{'eid':'D-…'},'doc':{'body':open('body.md').read()}}], open('bundles.json','w'))"
yak graph apply --bundles @bundles.json
```

When the owner answers questions, comment his words verbatim on the design
(`yak comment new D-… '<his words>'`), fold the answers into a "Decided"
section of the body, and drop what he rejected.

When his comment reshapes the design, the body changes in the same sitting as
your reply, with whatever is still open in its Open questions. The pull is to
wait for all his answers and revise once. Meanwhile the design tells every
other agent, and him, the old shape, and the new one lives only in a chat reply
that goes when your context does. A design with open questions is still the
current picture, and it's only useful while it stays current.

## Deciding it

`yak design decide D-… approved` stamps the caller as the decider: the tool
records the owner only when the owner is calling. So when he approves in
conversation, record the decision as yourself and put his approval verbatim in
a comment beside it. Downstream work you decide on your own (the task tree,
follow-ups) is recorded as yours (M-31958).

## The task tree

One task per thing (M-4492). A body is the irreducible ask plus pointers, not a
restatement of the design (M-14370): "D-…, task tree item 4." is often enough.
File the tree as one batch, with `$alias` eids and `requires` edges from a task
to what it needs, and look at the dry run first:

```json
[
  {"entity": {"eid": "$t1"}, "doc": {"title": "…", "body": "D-…, task tree item 1."}, "task": {}, "filed": {"project": "P-19"}},
  {"entity": {"eid": "$t2"}, "doc": {"title": "…", "body": "D-…, task tree item 2."}, "task": {}, "filed": {"project": "P-19"}},
  {"entity": {"eid": "$e1"}, "edge": {"from": "$t2", "to": "$t1"}, "requires": {}}
]
```

```sh
yak graph apply --bundles @tree.json --check   # see what it would do
yak graph apply --bundles @tree.json
yak task list '.task .order=-created.at' --limit 20   # read back the ids
```

An edge can point at an existing task by id (`"to": "T-…"`), which is how two
designs' trees depend on each other. A question only the owner can answer is
its own task with `--assignee U-3709`.

## When an agent drafts it

A long design is often drafted by an agent into a scratch file, and you read it
before the owner does. Check its claims against the code wherever they decide
anything, put it on the design, and tell the owner the gist with the components
written out, where you disagree, and the questions that need him. The rest
stays in the design.

When this skill is wrong or missing something, fix it in the same change.
