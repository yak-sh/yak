---
name: vocabulary
description: >
  Designing, adding, changing, renaming or reviewing a component or property of
  the graph's vocabulary, or modeling new data for a feature. Use it whenever
  you edit any vocab.json, write comp{…} in a design, task or reply, put a
  property into a bundle that no vocabulary declares yet, decide how to record
  that something happened or how two things relate, or review a design that
  proposes components, even when the request never says "vocabulary" or
  "component": "add a field", "track whether X happened", "store Y on the
  entity", "link X to Y", "keep a list of". Moving rows already stored into the
  new shape is `data-migration`; how a read or write of them behaves is
  `graph-reads-and-writes`.
---

# Designing vocabulary

A component is one aspect of an entity, and an entity is whatever its
components make it. Every package declares its words in its own
`packages/<name>/vocab.json`; the keyword table in packages/vocab/README.md
("The format") is the reference for what each keyword means. This skill is the
judgment around it: what goes wrong when a word is designed by feel.

## Say it with its properties

In a design, a reply or a task, write a component as `comp{prop, prop, …}`,
never the bare name. A name tells the reader nothing to evaluate; the
properties are the design (M-59030).

## Find the word before you coin one

Your recall returns a word's meaning, not its letters, so you will produce a
synonym for something that already exists and it will feel like the same word
(M-12915). Look first: `grep '"<word>"' packages/*/vocab.json`, `yak graph
schema`, or the inspector's component list. If the codebase already has the
idea under another name, use that name. If two names exist for one idea, or the
existing name is bad, propose one to the owner; he picks.

The same holds for anything a model or agent names at run time: two builds
looking for a topic at once minted "market design" and "economic market design"
for one subject. Whatever mints a named entity looks up the existing ones first
(by words and by meaning) and refuses a name that overlaps one (`topic_new`
does now).

A word also has a meaning outside this repo, and the field must match it.
"Exception" names the throw-and-catch mechanism and "error" names the mistake;
the vocabulary had them the other way round. A failure the code expected is a
refusal (`refuse()`, `CallError`), not an error. D-45640 designs the swap: an
`error{…}` is the tracked mistake, `exception{type, value, stack, …}` only what
was thrown in it, and today's `error{code}` becomes `refusal{code}`. Check the
term in the tools it comes from (Sentry, Java, git, SQL) before naming.

## Normalize: one aspect per component, one fact in one place

Factoring well pays back in every query: a component spans every kind that wears
it, and the next kind inherits it for free. Factoring badly is paid back later
as a migration, the most expensive change there is (the `data-migration` skill).

- **One aspect per component.** Its properties describe one aspect and are
  written together; two properties that change for different reasons are two
  components (M-14942). @yaks/mail keeps `deliver{to, tried}` (where it goes)
  apart from `delivered{at}` (that it arrived). The tell is reaching for
  whatever component you have open: ask whether the new property is the same
  aspect or another one riding along. A property that means the same thing as
  one on another kind is the loudest sign it belongs in a component of its own.
- **A fact lives in one place; everything else points at it by eid.** Copy a
  value only when its source sits in another store, or when it must stay as it
  was at a moment, and say which in the description: @yaks/git's `quote{text}`
  keeps a file's lines as they read at `revision{commit}`, and `cites{hash}`
  keeps the hash of what was cited when it was cited. Any other copy drifts
  from its source.
- **Point at the entity that already exists, not at text about it.** A commit
  is @yaks/git's `commit{target, repo, message}`, whose eid is its sha, so a
  release is a ref to it, not a string. A place in the code is @yaks/code's
  `module{blob, package}` or `symbol{module, name, kind, line}`. A person is an
  eid, never an email or a name. Text can only be read; an entity can be
  joined, renamed and followed.
- **One-to-many is a `ref` on the many side:** `comment{target}`,
  `filed{priority, project, assignee, domain}`, `claim{session, at}`,
  `built{build, slot, key, call, artifact, current}`. The one side stores
  nothing; a query reads the reverse with `.refs=`.
- **Many-to-many, or a relation with facts of its own, is an edge entity:**
  `edge{from, to, ord}` plus a relation component (@yaks/edge), such as
  `requires{}`, `contains{}`, `cites{hash}` or @yaks/model's `serves{name}`. Its
  eid is derived from from, relation and to, so linking twice is one link and
  unlinking is a delete. Never a JSON list of eids: no query can match inside
  it, no reference follows it, and no `death` cleans it up. A list of words
  that name things (`loot: [["tusk", 0.65]]`) is the same list keyed on names:
  it becomes edges (`edge{from: beast, to: item}` + `drops{odds}`) once the
  words become eids, not a JSON list of eids.
- **What you filter, join or group on is a property; what is read whole may
  be JSON.** The graph stores a JSON-valued property whole and refuses a query
  filter on it (packages/vocab/README.md). So a stack's frames can be one JSON
  list on the error that owns them, read whole (D-45640), while the one frame a
  bug is grouped by becomes a ref of its own (`bug{culprit}`, a symbol).
  `build{match}`'s binding tuple is JSON for the same reason: nothing filters
  on it.
- **Derived values are computed, not stored:** counts, totals, status.
  `build{…, cost}` sums what its calls spent, `built{…, current}` compares two
  keys, `session{…, status, cost}` are both computed. A stored copy of a
  derivable value is a snapshot that rots.
- **No kind or type property.** An entity is what its components make it; its
  kind is computed from them (`.kind=`), and renderers match on components. A
  property saying what the entity is restates its components. A property
  describing one aspect is fine: `symbol{module, name, kind, line}` says what
  kind of symbol, not what kind of entity.

## Identity: an eid, never a name

- **Derive the eid only where the facts are the entity.** `identity` makes
  two writers stating the same facts land on one entity: a link is its two
  ends and its relation, so `edge{from, to}` derives its eid, and two peers
  stating one link agree without asking each other (M-39645). Writing the same
  identity again patches that entity, and @yaks/graph refuses a bundle whose
  eid disagrees with it (packages/vocab/README.md, "`identity` declares
  deterministic entity ids").
- **Find an entity again by a key when the facts only locate it.** Something
  with a life of its own (a builder's output, rebuilt, cited and revised; an
  item a player holds) keeps a minted eid, and a key finds it again: a
  @yaks/key tag component declared `key: true`, whose `key{of, value}` row has
  the derived eid, so the value is unique by construction and a write
  claiming it again lands on its owner (packages/key/README.md). An entity can
  hold any number of keys, beside an identity of its own. `identity` is in the
  core keyword table and `key` only in its package, which is why agents reach
  for `identity` where a key belongs. @yaks/builders' `built{build, slot}` and
  `build{builder, match, variant}` are still identities; T-61728 moves them to
  keys.
- **Reuse an outside system's id when it is already unique:** a Claude
  session's id is the session entity's eid, a commit's sha is the commit's.
  Matching the two then needs no lookup.
- **Never key anything on a name.** Names change; Jeff: "names in any system
  must always be changeable. if you want non-changing values, use a UUID."
  Anything that must not move (a reference, a stored query, a derived eid)
  holds an eid. Eids are global (M-39645): never mint one that only makes sense
  in one store.
- **A readable handle is the external interface, never the reference.** People,
  seed files, commands and URLs need words: an alias (`alias{name}`, such as
  `sfx:water`, which @yaks/alias stores as a @yaks/key `key: true` row), a
  human number (`T-123`), a model's name. `g.address` resolves a handle to its
  eid at the door, on every write (packages/graph/README.md), and what is
  stored is the eid. Jeff: "it's an external interface, not an internal one.
  e.g. model names, aliases, etc etc. But nothing internally has to be
  migrated when those are changed." So a thing that needs a readable name gets
  an alias, not a slug property of its own, and no component stores a word as
  its reference: `item{kind: "tusk"}` and `slain{kind: "boar"}` key bags and
  kills on words that can then never change.

## Home a general word where its idea lives

Before putting a new component in the package you are working in, ask whether
another package would want it. A general word goes to the package that owns
the idea, so every caller finds one: `request{method, url, route, status, ms,
agent}` is @yaks/api's, `runtime{name, version, os}` sits on @yaks/process's
`process{pid, command, cwd, roles}`, and the shared marks are @yaks/kernel's.
A feature package that declares its own copy of a general word starts two
shapes of one thing.

Don't restate what a stamp already says. `created{by, at, via}` records who
wrote an entity and through which session, per entity (the writer each bundle
names, d76d39d1e). A component that also carries `person` or `session` for the
same fact is a second copy.

## What happened is a mark; where it stands is computed

A stored `state` or `status` property is an anti-pattern (M-59035): it is a
snapshot of events kept somewhere else, it drifts from them, and every writer
has to remember to update it. Record each event as a **mark**: a component with
stamped `at` and `by`/`via`, written once when it happens, removed when it is
undone. @yaks/kernel holds the shared ones: `completed{at, by, via}`,
`failed{at, by, via, reason}`, `broken{at, by, via, code}`,
`resolved{at, by, via}`, `archived{at, by, via}`, `verified{at, by, via}`. Reuse
one before minting another, and keep their meanings apart: `resolved` (the
problem stopped happening, perhaps with no work done) is not `completed` (the
work finished). `interrupted{at, by, via, code}` is designed (D-45640) but not
yet declared.

Where the entity stands is then the **`status`** keyword on the component: an
ordered map from a component to the status it gives, plus `default`
(`task`'s is `{"cancelled": "cancelled", "completed": "done", "default":
"open"}`). It yields a computed, read-only `status` property that SQL and
in-memory readers both build from the declaration, and a filter on it uses the
archetype index. Another package adds a rung through `extends` (@yaks/session
adds `claim` → `wip` to `task`). Mark names the shape; `status` names the
keyword. D-59037 lists the stored states still being converted.

## A missing value fails closed

A default for something new is not a reading for something missing. Write the
default explicitly when the entity is made (`app_new` writes `public`), and read
a missing value as the safe side: an app with no access mode is private
(`mode()` in packages/member/words.ts), and a missing mode is reported as a
failure. A reader that falls back to the open choice turns a lost or stale row
into an exposure.

## Requirements come from the owner, not from today's behavior

When a component replaces something, its shape follows what it is for, not
what the old code happened to do. Drafts were kept per browser tab only because
sessionStorage did that, and a `durable: tab` lifetime was invented to keep it;
The owner had always wanted a draft kept and synced everywhere, and the keyword was
deleted. A draft is `draft{by, place, text, rev}` (@yaks/draft): synced, kept
for good, on an eid every interface derives the same way. A person's input is
never given a short lifetime (M-59093). Before writing a constraint into a
component, ask whether it came from the owner or from the code.

## Configuration that varies is rows

What differs by deployment or changes without a release is data, not code: a
provider is `provider{name, transport, credential, base, api, fallback,
offered}`, a model `model{name, vendor, grade, label, modalities, efforts,
effort, offered}`, joined by `serves{name}` edges (M-36709). Adding a model,
moving one to another server or switching the embedder is then a write.

## One home per word, and per description

A name is declared in exactly one vocab.json; composing two declarations
throws. Another package adds properties with `extends: true`, never a second
declaration (M-17871). Two shapes of one thing is the bug; a rename is a
rename, done everywhere in one change with the stored data migrated (the
`data-migration` skill), including every app store and kept version.

A description has one home too: a component's lives in its declaration, where
agents, the inspector and the MCP schema all read it; a package's lives in its
deno.json, which jsr publishes. Write it as a sentence a stranger can use.

Platform words and app words share one namespace today, and they collide: the
platform taking `cost` broke an app that already declared its own
`cost{euros, who, paid}`. An app's own word now wins in its own store
(730cddb55), and `deno task app-grep` shows whether any app holds a word before
the platform takes it. Namespacing (D-59567) is designed, not built: every
vocabulary gets a namespace, names become changeable labels, and identity is a
UUID.

## UX state and events

CamelCase is a UX component's own state or event, declared by @yaks/ux,
page-only (`sync: none`), on an entity the consumer names (D-58967):
`Edit{open, query}`, `Stack{panes}`. An event is a component with
`durable: "0s"`: applied and handed on, never stored or journaled
(`Refused{said}`). A UX component declares no rules; data names and front-end
rules belong to the domain package.

## Lifetime, reach and ownership

Decide these per component, on purpose:
- **Who hears a write:** `sync` (`server` by default; `none` for page-only
  state; `peers` for presence).
- **How long it lives:** `durable` (`forever` by default; `connection`; a
  duration; `"0s"` for an event).
- **Who may write it:** `stamped` for server-owned properties, `wire: false`
  for a component clients only read.
- **What it points at:** `ref` names the kind; `death` says what a delete does
  to the reference (`cascade`, `detach`, `release`, `keep`). A reference into
  another store is `keep`.
- **How it is found:** `search` for full-text, `embed: false` for an entity that
  should never be embedded (tool results, logs).

## Before you land a vocabulary change

- The name was looked up, means what it says outside this repo too, and every
  use of an old name moved.
- Each new component is written `comp{prop, …}` in its task or design.
- Each component is one aspect, homed where its idea lives; no fact is stored
  twice; relations are refs or edges, never lists of eids; nothing derivable is
  stored; nothing is keyed on a name.
- No stored state; lifecycles are marks plus `status`.
- A missing value reads as the safe side, and every constraint traces to the owner.
- Its description says what it is in a sentence a stranger can use.
- Stored rows on the box and on the platform are migrated with the
  `data-migration` skill, and no app's own vocab.json declares the new word
  (`deno task app-grep`).

When this skill is wrong or missing something, fix it in the same change.
