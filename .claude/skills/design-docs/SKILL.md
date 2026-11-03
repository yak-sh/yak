---
name: design-docs
description: >
  Use for proposals or designs beyond a bug fix or small feature, D- entity
  drafting/revision/decision/task trees, design_decide, and changes adding
  or moving packages, vocabulary or workers. Component shapes are
  vocabulary; package wiring is packages-and-plugins. Small features and
  fixes are done directly.
---

# Writing a design

A design is the graph's record of a proposed change (`design{}` + `doc{title,
body}` + `proposed{}`), filed before the work. The repo documents what is; the
design holds what's proposed. It is true enough to trust and short enough for
the owner to read in a couple of minutes.

He told us, about D-124238: "that design is too long for me to read". Designs
written for him had grown to 10,000 to 15,000 characters. So the body is what
he reads, and it holds three things: the proposal in a few sentences, what
changes for a person, and his questions at the end, each with your
recommendation. The detail an agent needs to build it (components, package
boundaries, migration) goes into the tasks of the task tree, where the agent
who builds it will look.

He doesn't read them all and never blocks on one. When it looks good, decide it
yourself, build, and adapt afterwards. Only a refactor of something key the
system relies on is flagged to him, in one line. Priority goes to yaks.app over
local harness experiments (M-38025).

It's the document around parts other skills shape: each component is shaped
in `vocabulary`, each package and its boundary in `packages-and-plugins`, and
moving stored rows is `data-migration`. Once the shape is settled, its task
tree becomes work agents are briefed on (`agent-briefs`).

## What a design carries

- **Where things live** (M-38025). Inside a package, mess is cheap to fix
  later; the boundaries between packages are expensive to move. So the tasks
  name each package or worker the work touches or adds, what each owns, what
  it offers others (verbs in words, not types), and what moves. An existing
  package that owns the idea comes first; a new one is for an idea nothing
  owns yet.
- **What is in a component** (M-59030). He judges a component by its
  properties, so each one is written `comp{prop, prop, …}` wherever it
  appears, in a task or in what you tell him. The name alone gives him
  nothing to judge.
- **His own words** (M-31946): the messages that shaped the design, verbatim
  and dated, as comments on it. Your summary of him is strictly less than
  what he said.
- **His questions are few.** Before a question goes to him, ask whether the
  answer is reversible, costs no money and turns on no preference only he
  holds. If so it is yours: write the decision and its reason in the design, and
  build (M-4492; "why is that blocked on me? by all means, add visit
  tracking"). What remains carries the option you'd pick and why.

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

What he reads, in order, in a page or less:

1. The proposal: what changes and why, in a few sentences.
2. What changes for a person: what they see or do differently.
3. Open questions only he can answer, each with a recommendation.

Everything else (the model, where things live, migration with one shape after
and no yaks app taken down, his words) is in the task tree's tasks and the
comments, each task carrying what its builder needs. The body is plain prose
about what will be, with no dates or history; provenance lives in the commits
and the quotes.

## Filing it

`design_new` files the title, body and project together:

```json
{"title":"<what it proposes, in one line>","project":"P-19","body":"<the proposal>"}
```

The CLI mirror also reads a drafted body from a scratch file:

```sh
yak design new "<what it proposes, in one line>" @/path/to/body.md --project P-19
```

Any argument starting with `@` is read as a file path (the @file door), so
`yak task new "@yaks/ui …"` fails with "No such file or directory". Phrase such
a title so it doesn't start with `@` ("The @yaks/ui style guide …").

One proposal is one design, so `graph_apply` revises its body rather than
minting a second. A full replacement takes `id`, `text`, and the `was` token
from `graph_show`:

```json
{"id":"D-…","text":"<the revised proposal>","was":"<read-token>"}
```

```sh
yak graph apply --id D-… --text @body.md --was <read-token>
```

For a small revision, send only the changed words through `graph_apply`:

```json
{"edits":[{"id":"D-…","text":[{"path":"doc.body","find":"The old wording.","replace":"The revised wording."}]}]}
```

The tool reads the body and guards that version itself. `prepend` and
`append` add text without replacing what is there (`graph-reads-and-writes`).

When he comments, record his words verbatim on the design
(`comment_new` with target `D-…` and body '<his words>'),
fold the answers into a "Decided" section of the body, and drop what he rejected.

When his comment reshapes the design, the body changes in the same sitting as
your reply. The design tells every other agent the old shape until it does, and
the new one lives only in a chat reply that goes when your context does.

## Deciding it

When a design looks good, `design_decide` it yourself with design `D-…`
(verdict defaults to `approved`; pass `declined` to decline) and build:
the tool stamps the caller as the decider, which is the agent's decision
recorded as the agent's (M-31958). When he approves in conversation, put his
approval verbatim in a comment beside it. `design_decide` accepts `by` to record
his explicit verdict on that design (`yak design decide D-… approved --by
U-3709`); the session stays in `via`. The task tree and follow-ups are yours too.

A design's verdict and the owner's comments on it outrank its body. A body is
what was proposed; it reads as settled whether or not he agreed, and his later
words often reverse parts of it. So before you tell anyone what a design plans,
or edit it, read `decided` with `graph_show` (ids `["D-…"]`) and every comment
with `memory_thread` (id `D-…`).
A declined design is a record, not the plan.

## The task tree

One task per thing (M-4492). A body is the irreducible ask plus pointers, not a
restatement of the design (M-14370): "D-…, task tree item 4." is often enough.
`task_new` files the tree in one call. Shared fields are defaults for its
`tasks` rows; local `$ids` let `parent` and `requires` name tasks created in
the same call:

```json
{
  "project": "P-19",
  "tasks": [
    {"id":"$plan","title":"…","body":"D-…, task tree."},
    {"id":"$t1","parent":"$plan","title":"…","body":"D-…, task tree item 1."},
    {"parent":"$plan","requires":["$t1"],"title":"…","body":"D-…, task tree item 2."}
  ]
}
```

`parent` makes a `contains` link from the parent; `requires` makes a link from
the task to what it needs. Either can name an existing id, which is how two
designs' trees depend on each other. `check: true` previews the whole plan.
The CLI takes the same task rows as an array argument, from a file if useful:

```sh
yak task new --project P-19 --tasks @tasks.json --check
yak task new --project P-19 --tasks @tasks.json
```

The result names each filed task beside its local alias. A question only the
owner can answer (irreversible, spends money, or a preference only he holds) is its own task with `assignee: "U-3709"`.

## When an agent drafts it

A design is often drafted by an agent into a scratch file, and you read it
before it goes on the design; a draft that runs past a page is cut, its detail
moved into the tasks. Check its claims against the code wherever they
decide anything, then file it and build. Tell the owner only what he asked for,
or a refactor of something key, with the components written out.

The drafter takes its brief as the requirement. A shape you sketch there
("names are rows keyed by stable ids") comes back filled in, with new words
coined to fit it, and it never looks for the package that already owns the
idea. So the brief carries the owner's words and pointers to what is, not
your shape. Reading the draft, put every new component beside the vocabulary
already declared (`grep -l '"component": true' packages/*/vocab.json`) and the
packages that own the idea; a word the draft added beside an existing one is
the first thing to cut.

When this skill is wrong or missing something, fix it in the same change.
