---
name: vocabulary
description: >
  Designing or changing the graph's vocabulary: adding a component or property,
  naming one, deciding where it is declared, recording a lifecycle (done, failed,
  interrupted, resolved), choosing sync/durable/stamped/ref/death, renaming a
  word, or a word that collides with an app's. Use it whenever a vocab.json is
  about to change or a design proposes new components, even if the task only
  says "add a field", "track whether X happened" or "store Y on the entity".
---

# Designing vocabulary

A component is one aspect of an entity, and an entity is whatever its
components make it. Every package declares its words in its own
`packages/<name>/vocab.json`; the keyword table in packages/vocab/README.md
("The format") is the reference for what each keyword means. This skill is the
judgment around it: what goes wrong when a word is designed by feel.

## Find the word before you coin one

Your recall returns a word's meaning, not its letters, so you will produce a
synonym for something that already exists and it will feel like the same word
(M-12915). Look first: `grep '"<word>"' packages/*/vocab.json`, `yak graph
schema`, or the inspector's component list. If the codebase already has the
idea under another name, use that name. If two names exist for one idea, or the
existing name is bad, propose one to Jeff; he picks.

A component earns its place by cohesion: its properties describe one aspect
and are written together (M-14942). If two properties change for different
reasons, they are two components.

## Say it with its properties

In a design, a reply or a task, write a component as `comp{prop, prop, …}`,
never the bare name. A name tells the reader nothing to evaluate; the
properties are the design (M-59030).

## What happened is a mark; where it stands is computed

A stored `state` or `status` property is a snapshot that drifts from the events
that produced it (M-59035). Record each event as a **mark**: a component with
stamped `at` and `by`/`via`, written once when it happens, removed when it is
undone. The kernel holds the shared ones today: `completed{at, by, via}`,
`failed{at, by, via, reason}`, `broken{at, by, via, code}`,
`resolved{at, by, via}`, `archived{at, by, via}`, `verified{at, by, via}`. Reuse
one before minting another; `resolved` (the problem stopped) is not
`completed` (the work finished). `interrupted{at, by, via, code}` is designed
(D-45640) but not yet declared.

Where the entity stands is then the **`status`** keyword on the component: an
ordered map from a component to the status it gives, plus `default`. It yields a
computed, read-only `status` property that SQL and in-memory readers both build
from the declaration, and a filter on it uses the archetype index. Mark names
the shape; `status` names the keyword. D-59037 lists the stored states still
being converted.

## One home per word

A name is declared in exactly one vocab.json; composing two declarations
throws. Another package adds properties with `extends: true`, never a second
declaration (M-17871). Two shapes of one thing is the bug; a rename is a
rename, done everywhere in one change with the stored data migrated (see the
`migrate` skill), including every app store and kept version.

Name conventions that carry meaning:
- `_comp`, `_prop`, `_tx`: a leading `_` is the vocabulary describing itself;
  its properties never answer to a bare name.
- `Edit`, `List`, `Refused`: CamelCase is a UX component's own state or event,
  page-only (`sync: none`), declared by @yaks/ux (D-58967).
- Platform words and app words share one namespace today. An app that declared
  a word before the platform took it keeps it in its own store, and installing
  such an app is refused until namespacing lands. Namespacing (D-59567) is
  designed, not built: names become changeable labels and identity a UUID.

## Lifetime, reach and ownership

Decide these per component, on purpose:
- **Who hears a write:** `sync` (`server` by default; `none` for page-only
  state; `peers` for presence).
- **How long it lives:** `durable` (`forever` by default; `connection`; a
  duration). An event is `durable: "0s"`: applied and handed on, never stored.
  A person's input is never given a short lifetime (M-59093).
- **Who may write it:** `stamped` for server-owned properties, `wire: false`
  for a component clients only read.
- **What it points at:** `ref` names the kind; `death` says what a delete does
  to the reference (`cascade`, `detach`, `release`, `keep`). A reference into
  another store is `keep`.
- **How its id is made:** `identity` derives the eid from properties, so the
  same facts land on the same entity. Eids are global (M-39645): never mint one
  that only makes sense in one store.
- **How it is found:** `search` for full-text, `embed: false` for an entity that
  should never be embedded (tool results, logs).

## Before you land a vocabulary change

- The name was looked up, and every use of an old name moved.
- Each new component is written `comp{prop, …}` in its task or design.
- No stored state; lifecycles are marks plus `status`.
- Its description says what it is in a sentence a stranger can use: agents,
  the inspector and the MCP schema all read it.
- Stored rows on the box and on the platform are migrated with the
  `migrate` skill, and no app's own vocab.json declares the new word
  (`deno task app-grep`).
