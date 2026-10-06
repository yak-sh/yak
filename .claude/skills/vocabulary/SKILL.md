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
  entity", "link X to Y", "keep a list of", and whenever you move state that
  code keeps outside the graph (a Map, an array, localStorage, IndexedDB, a
  cache, a module's variables) into it. Moving rows already stored into the
  new shape is `data-migration`; how a read or write of them behaves is
  `graph-reads-and-writes`.
---

# Designing vocabulary

A word in the graph outlives the code that coined it. A component is one aspect
of an entity, and an entity is whatever its components make it. Every package
declares its words in its own `packages/<name>/vocab.json`, and once a word
holds rows on the box and in every app store, changing it is a migration
everywhere (`data-migration`), the most expensive change there is. The keyword
table in packages/vocab/README.md ("The format") is the reference for what each
keyword means; this skill is the judgment around it. It usually sits inside a
design (`design-docs`); how the words are then written and read is
`graph-reads-and-writes` and `query-grammar`.

Designing a word sets the moment against the long run. In the moment, the
component you have open is right there, the code you're replacing already has a
shape, a name is easier to hold than an eid, and a `status` string is one
property instead of a few marks. Over the long run each of those becomes a copy
that drifts, a name that can't change, a lifecycle nobody can audit. So model
the world, not the code: ask what the thing is, which aspect of it this is, who
writes it and who reads it, and what already exists, before asking what the old
code did.

The owner judges a design by its properties. Jeff, verbatim (M-59030): "just
the names of comps without `comp{prop, ...}` is not very useful to me. i
evaluate by what's in the comp, not just the name". So wherever a component is
proposed (a design, a reply, a task), it is written `comp{prop, prop, …}`.

## Find the word before you coin one

Your recall returns a word's meaning, not its letters, so you will produce a
synonym for something that already exists and it will feel like the same word.
Jeff, verbatim (M-12915): "it's like agents really do run on "vibes". as long
as the vibe of the word is the same, they can't tell them apart". Look the
string up: `grep '"<word>"' packages/*/vocab.json`, `yak graph schema`, or the
component list in `yak inspect`. If the codebase already has the idea under
another name, that's the name. If two names exist for one idea, or the existing
name is bad, propose one to the owner; he picks.

The same holds for anything a model or agent names at run time: two builds
looking for a topic at once minted "market design" and "economic market design"
for one subject. Whatever mints a named entity looks up the existing ones first
(by words and by meaning) and refuses a name that overlaps one, as `topic_new`
does (`overlaps` in packages/memory/topic.ts).

A word also has a meaning outside this repo, and the field's meaning wins.
"Exception" names the throw-and-catch mechanism and "error" names the mistake;
the vocabulary had them the other way round until D-45640 swapped them. Now
`error{at, level, message, fault, bug, …}` (@yaks/tracker) is one occurrence
of a tracked mistake, `exception{type, value, stack, …}` (@yaks/tools) is only
what was thrown in it, and a failure the code expected is a `refusal{code}`
(`Refused`, `CallError`, `refuse()`), not an error. Check the term in the tools
it comes from (Sentry, Java, git, SQL) before naming.

## One aspect per component, one fact in one place

Factoring well pays back in every query: a component spans every kind that
wears it, and the next kind inherits it for free. Factoring badly is paid back
later as a migration.

- **One aspect per component.** Its properties describe one aspect and are
  written together; two properties that change for different reasons are two
  components (M-14942). @yaks/mail keeps `deliver{to, waiting, tried}` (where it
  goes) apart from `delivered{at}` (that it arrived). The pull is toward
  whatever component you have open, so ask whether the new property is the same
  aspect or another one riding along. A property that means the same thing as
  one on another kind is the loudest sign it belongs in a component of its own.
- **A fact lives in one place; everything else points at it by eid.** A copy
  is right only when its source sits in another store, or when it must stay as
  it was at a moment, and its description says which: @yaks/git's
  `quote{text}` keeps a file's lines as they read at `revision{commit}`, and
  `cites{hash}` keeps the hash of what was cited when it was cited. Any other
  copy drifts from its source.
- **Point at the entity that already exists, not at text about it.** A commit
  is @yaks/git's `commit{target, repo, message}`, whose eid is its sha, so a
  release is a ref to it, not a string. A place in the code is @yaks/code's
  `module{blob, package}` or `symbol{module, name, kind, line}`. A person is an
  eid, not an email or a name. Text can only be read; an entity can be joined,
  renamed and followed.
- **One-to-many is a `ref` on the many side:** `comment{target, reply_to}`,
  `filed{priority, project, assignee, domain}`, `claim{session, at}`,
  `built{build, slot, key, call, artifact, current, …}`. The one side stores
  nothing; a query reads the reverse with `.refs=`.
- **Many-to-many, or a relation with facts of its own, is an edge entity:**
  `edge{from, to, ord}` plus a relation component (@yaks/edge), such as
  `requires{}`, `contains{}`, `cites{hash}` or @yaks/model's `serves{name}`. Its
  eid is derived from from, relation and to, so linking twice is one link and
  unlinking is a delete. A JSON list of eids gives all of that up: no query
  matches inside it, no reference follows it, and no `death` cleans it up. A
  list of words that name things (`loot: [["tusk", 0.65]]`) is the same list
  keyed on names, and becomes edges (`edge{from: beast, to: item}` +
  `drops{odds}`) once the words become eids.
- **What you filter, join or group on is a property; what is read whole may be
  JSON.** The graph stores a JSON-valued property whole and refuses a query
  filter on it (packages/vocab/README.md). So a stack's frames are one JSON list
  on the exception that owns them, `exception{frames, …}`, read whole, while
  the one frame a bug is grouped by is a ref of its own (`bug{culprit, …}`, a
  symbol). `build{match}`'s binding tuple is JSON for the same reason: nothing
  filters on it.
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

Names change; Jeff: "names in any system must always be changeable. if you
want non-changing values, use a UUID." And the graph is global (M-39645), so an
eid means the same thing in every store. Anything that must not move (a
reference, a stored query, a derived eid) holds an eid.

- **Derive the eid where the facts are the entity.** `identity` makes two
  writers stating the same facts land on one entity: a link is its two ends and
  its relation, so `edge{from, to}` derives its eid, and two peers stating one
  link agree without asking each other. Writing the same identity again patches
  that entity, and @yaks/graph refuses a bundle whose eid disagrees with it
  (packages/vocab/README.md, "Identity and indexes").
- **Find an entity again by a key when the facts only locate it.** Something
  with a life of its own (a builder's output, rebuilt, cited and revised; an
  item a player holds) keeps a minted eid, and a key finds it again: a @yaks/key
  tag component declared `key: true`, whose `key{of, value}` row has the derived
  eid, so the value is unique by construction and a write claiming it again
  lands on its owner (packages/key/README.md). An entity can hold any number of
  keys, beside an identity of its own. `identity` is in the core keyword table
  and `key` only in its package, which is why agents reach for `identity` where
  a key belongs. @yaks/builders' minted builds are found by `build_of{}` on
  `key{of, value}` (builder/variant/binding tuple), and all outputs by
  `output_of{}` (build/slot); edge outputs also keep their ends-and-relation
  identity. `held` (packages/key/resolve.ts) finds a batch of owners with no
  query or scan; `build{builder, match, variant}` and `built{build, slot}` are
  history (stale builds, dropped links), not a second index. A row whose
  properties happen to match is not a key's owner, so a store whose rows predate
  their keys is migrated, not read through a fallback that keeps the old shape
  alive.
- **Reuse an outside system's id when it is already unique:** a Claude
  session's id is the session entity's eid, a commit's sha is the commit's.
  Matching the two then needs no lookup.
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

A stamp already says who wrote an entity. `created{by, at, via}` records who
wrote it and through which session, per entity (the writer each bundle names,
d76d39d1e), so a component that also carries `person` or `session` for the same
fact is a second copy.

## What happened is a mark; where it stands is computed

Jeff, verbatim (M-59035): "i tend to think that `state` props are an
anti-pattern." A stored `state` or `status` is a snapshot of events kept
somewhere else: it drifts from them, and every writer has to remember to update
it. So each event is recorded as a **mark**: a component with stamped `at` and
`by`/`via`, written once when it happens, removed when it is undone. @yaks/kernel
holds the shared ones: `completed{at, by, via}`, `failed{at, by, via, reason}`,
`broken{at, by, via, code}`, `interrupted{at, by, via, code}`,
`resolved{at, by, via}`, `archived{at, by, via}`, `verified{at, by, via}`. One
of these usually already says it, and their meanings stay apart: `resolved`
(the problem stopped happening, perhaps with no work done) is not `completed`
(the work finished).

Where the entity stands is then the **`status`** keyword on the component: an
ordered map from a component to the status it gives, plus `default`
(`task`'s is `{"cancelled": "cancelled", "completed": "done", "default":
"open"}`). It yields a computed, read-only `status` property that SQL and
in-memory readers both build from the declaration, and a filter on it uses the
archetype index. Another package adds a rung through `extends` (@yaks/session
adds `claim` → `wip` to `task`). Mark names the shape; `status` names the
keyword. D-59037 is converting the stored states that remain.

## A missing value fails closed

A default for something new is not a reading for something missing. The
default is written explicitly when the entity is made (`app_new` writes
`public`), and a missing value reads as the safe side: an app with no access
mode is private (`mode()` in packages/member/words.ts), and a missing mode is
reported as a failure. A reader that falls back to the open choice turns a lost
or stale row into an exposure.

## Requirements come from the owner, not from today's behavior

When a component replaces something, its shape follows what it is for, not what
the old code happened to do. Drafts were kept per browser tab only because
sessionStorage did that, and a `durable: tab` lifetime was invented to keep it.
Jeff, verbatim (M-59093): "a "draft" is not some throw-away thing; it is
precious user data that should never be lost". The keyword was deleted. A draft
is `draft{by, place, text, rev}` (@yaks/draft): synced, kept for good, on an eid
every interface derives the same way, and a person's input never gets a short
lifetime. Before a constraint goes into a component, ask whether it came from
the owner or from the code.

## Moving state that code keeps into the graph

Code that keeps state outside the graph (a module's Map or array, localStorage,
IndexedDB, a cache, an object's fields) pulls you to transcribe it: the same
keys, the same nesting, poured into a component, often with a prefix to tell it
apart. A `page_seen{level, x, z, yaw}` was once minted beside an app's own
`seen{level, x, z, yaw, at, teleport}`, and a `settings{json}` would have held
whatever localStorage held. That keeps the old model and gives it a second home.
The code in front of you was shaped by the tool it used (a key-value store, a
Map keyed by a string), not by what the data means, and from the inside copying
it feels like moving it.

So model it as if the code did not exist:

- Find the entity each value is an aspect of (a person, their hero, a land, a
  chunk, the page) and put it there, in a word that already exists where one
  does.
- Ask who writes it and who reads it. Readers query or subscribe; nothing keeps
  its own copy or index of what the graph holds.
- What can be derived is computed (a query, a rule, a `computed` property), not
  stored beside its source.
- The code that kept the copy in step (a handler updating a Map, a save on
  change) becomes a rule, an effect or a subscription (M-39551).
- The page's own state is a UX component (CamelCase, `sync: none`) on an entity
  the page names; a person's settings and drafts are theirs, synced (M-59093).

When the graph cannot say what the model needs, that is the finding, and minting
around it would hide it. For instance, `sync` is declared per component
(packages/client/README.md), so a word cannot stay on the page for some entities
and sync for others; a model that needs that has found a platform gap. It gets
filed and fixed in the package that owns it (M-41238), and the model says which
gap it hit.

The model goes on the task before building (each component `comp{prop, …}`,
the entity it sits on, who writes and reads it, what replaces the code), so it
can be spot-checked.

## Configuration that varies is rows

What differs by deployment or changes without a release is data, not code: a
provider is `provider{name, transport, credential, base, api, fallback, …}`, a
model `model{name, vendor, grade, label, modalities, efforts, effort, …}`,
joined by `serves{name}` edges (M-36709). Adding a model, moving one to another
server or switching the embedder is then a write.

## One home per word, and per description

A name is declared in exactly one vocab.json; composing two declarations
throws. Another package adds properties with `extends: true`, not a second
declaration (M-17871). Two shapes of one thing is the bug, so a rename is a
rename: done everywhere in one change, with the stored data migrated
(`data-migration`), including every app store and kept version.

A description has one home too: a component's lives in its declaration, where
agents, the inspector and the MCP schema all read it; a package's lives in its
deno.json, which jsr publishes. It is a sentence a stranger can use.

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
`Edit{open, query}`, `Stack{panes, scroll}`. An event is a component with
`durable: "0s"`: applied and handed on, never stored or journaled
(`Refused{said}`). A UX component declares no rules; data names and front-end
rules belong to the domain package.

## Lifetime, reach and ownership

Each component answers these on purpose, through its keywords:

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

## Reading it back

Before it lands, read the change as the owner will, property by property. A
good one reads like the world described plainly: each word looked up and true
outside this repo too, each component one aspect homed where its idea lives,
relations as refs and edges, lifecycles as marks with a computed `status`,
nothing stored twice or derivable, nothing keyed on a name, a missing value on
the safe side, every constraint traceable to him, and a description a stranger
can use. Its rows on the box and in every app store move with it
(`data-migration`), and `deno task app-grep` says no app already declares the
word.

When this skill is wrong or missing something, fix it in the same change.
