---
name: platform-visualize
description: >
  Read the running platform's composed anatomy and bounded causal activity with
  @yaks/visualize, its /visualize page, agent tools and yak visualize command.
  Use it whenever you need to see what is wired, which package owns a part,
  whether a facet is declared, loaded or bound, what ran after a write, why a
  connection looks missing, or whether a quiet trace means nothing happened;
  and when changing packages/visualize. Stored rows and read/write behavior are
  graph-reads-and-writes; graph query syntax is query-grammar, not anatomy's
  plain-text search. Wiring packages is packages-and-plugins; changing effects
  or rules is effects-and-rules. Building the screen is ui-building, not just
  reading it. Automated assertions are testing; proving commands or the page
  on an isolated scratch host is end-to-end-checks. Observation is not proof.
---

# Platform anatomy and activity

The owner asked for "an MRI machine for the platform and system" (T-61829,
verbatim): one place where agents and humans see how the vocab, packages,
plugins, effects, rules, views, kits and the rest fit together. He added: "i
don't want a "dead" view only, i want to see data flowing in real-time", and
"it'd be great if it doesn't add any overhead to existing servers".
@yaks/visualize is that machine, and like MRI and fMRI it takes two kinds of
scan.

- **Anatomy** is the serving host's value-free description of its composed
  parts and how they connect, in groups: packages, roles, facets, comps, tools,
  commands, effects, rules, hooks, routes, views, inspectViews, tui, kits,
  themes, skills and secrets.
- **Activity** is a bounded subscription to that host graph's trace channel
  (@yaks/trace): spans with a name, a causal parent, counts, a duration and an
  outcome.

Both image the patient on the table, the host that is serving them. Neither
reads stored entities, neither composes a second platform to look at, and
neither reconstructs work done by other processes sharing the store.

## The instrument

packages/visualize/README.md is the reference for the DTOs, bounds, coverage
and each door's parameters. Inside the package, `snapshot.ts` owns selection and
`capture.ts` a bounded activity capture; `http.ts`, `tools.ts` and `cli.ts` are
doors over those two. To compare doors, compare the same snapshot or capture,
never a graph assembled separately, whose bindings may differ.
@yaks/code/anatomy maps a composition into anatomy, and packages/cli/anatomy.ts
gathers a native host's evidence for it.

- **The page** is `/visualize` on the serving origin: an anatomy map and list,
  the apply pipeline's spine, a timeline and a causal drill-down. It's a way to
  explore a host, not a replacement for the inspector.
- **The agent tools** are `visualize_anatomy` and `visualize_activity`, on their
  own tool host. Their advertised inputs carry the current bounds, and the
  activity tool's wait only watches: it runs no query and makes no write.
- **The terminal** reads the serving process over HTTP rather than composing a
  graph of its own:

```sh
yak visualize anatomy --group tools --json
yak visualize activity --limit 32 --wait 250 --json
```

`--url` picks another HTTP(S) serving origin. `--json` prints the exact DTO;
without it you get a bounded overview. `--search` is plain text over a part's
name, package, facet and description, and `--id` is an anatomy part id.

## A fuller picture, or the same patient

It would be easy to make the picture look more complete: import the lazy
facets, resolve the secret getters, compose a graph of one's own and draw that.
Each would show a different patient. So visualize describes what is there and
says plainly what it could not see.

That's why declaration, loading and binding are three separate facts. A
declared lazy facet need not have been imported; an imported tool need not be
bound to this host. On the box most tools read declared and neither loaded nor
bound, because a plugin's tool code is imported only by the first call of one
of its tools. That's the system working, not a wiring fault.

## Insight, and nothing private

Anatomy and activity carry no entity contents, query text, payloads or secret
values; a secret part is a name. That restraint is what lets this be a web page
and an agent door at all. It also means the visualizer is the wrong instrument
when the question is about values: what a write stored or a query returned is
`graph-reads-and-writes` and `query-grammar`. A span's name, count and duration
don't tell you what it returned. Anatomy search isn't a yaks query either:
`.task.status=open` pasted into it inspects no tasks.

## Live, and nearly free when nobody watches

Recording is subscriber-only. Producers peek at the channel, and with nobody
listening they make no events, ids or clock reads. Even so, the idle branch
measures roughly 128 to 214 ns per query, so every addition to it is paid on
every query nobody is watching. The price of that bargain is that idle history
doesn't exist: work done before you subscribed isn't reconstructed, and another
process using the same database is on a different channel. So subscribe before
the action, or take a capture whose wait spans it, and read an empty capture as
"nothing seen", never as "nothing happened".

## Reading the scan

A radiologist reads the field of view before calling a shadow absent. Here the
field of view is coverage, and it comes with every answer.

- **Unobserved isn't absent.** A snapshot carries its scope and a per-group
  `observed` flag. A native snapshot of the box marks views, inspectViews, tui
  and skills unobserved; the box has views, the server just never loads them.
- **Empty can mean four things**: a filter, a limit, a host that can't observe
  that group, or no such parts. Selection's `{total, matched, shown,
  truncated}` tells them apart. It counts nodes; an edge is kept only when both
  its ends are. An unfiltered HTTP anatomy read returns the supplier's snapshot
  unchanged, with no `selection`, while the agent tool always selects, so the
  two needn't look alike.
- **A part id isn't an entity id**, and an activity event isn't a graph row.
- **Causes are parents.** Start and end share a span id, and parent span ids
  are the causal path. A duration of 0 ms is a valid measurement: in a Worker
  the clock moves only on I/O, so on yaks.app counts are the measure.
- **Sequence numbers live within an epoch.** A changed epoch means continuity
  is gone (restarting the host resets it), and spans aren't compared across
  it.
- **Two kinds of gap.** A capture's `gap` counts known omitted records, those
  cut by its limit or overwritten while it ran; it can't count work never
  recorded. The page's gap indicator counts discontinuity episodes: a pause
  closes the stream, and its resume adds one. A disconnect alone doesn't
  prove anything was lost. Read the connection state and the epoch before
  taking a quiet stretch for a quiet platform.
- **The page's pipeline labels** (normalize, admit, … commit, effect, audit)
  are explanatory nodes drawn by the page, not a server anatomy group. Audit is
  rollback notification, not what follows a successful apply.

## The door asks like any other

Metadata gets no back door. Every request goes through the serving host's
`host.who`; a host with no policy fails closed, and anonymous access is only
there when the policy grants it. The CLI uses the selected origin's saved
token, keeps `YAKS_TOKEN` as the explicit override, refuses URL credentials,
non-HTTP(S) schemes and redirects, and never forwards one host's credential to
another. `x-via` is provenance, not a credential. A probe refused on auth is
telling you about the policy; loosening the policy to get through would only
silence what it's telling you.

## A diagnosis, not proof

Anatomy narrows a wiring question; a trace finds a causal path. The owning
subsystem then confirms the claim: a rule in the picture isn't proof it fired
correctly, and an apply span isn't proof its stored result is right. What the
picture shows is wired by `packages-and-plugins`, named by `vocabulary` and set
in motion after a write by `effects-and-rules`. Automated assertions over the
doors are `testing`. Checking the page or the CLI by hand is
`end-to-end-checks`, on an isolated scratch host running the branch's own code
rather than the live service. Changing the page itself is `ui-building` too.

## Adding to what it sees

There is one measured stream. New observation extends @yaks/trace
(packages/trace/mod.ts), and other consumers such as the tracker's timing
(D-61711) read that same stream rather than timing things again. A label names
code, never a query, URL, entity, credential or payload, and counts are finite
numbers. The inactive path stays free of events, ids and clocks, observers
release on cancellation, abort and close, and spans are not persistent history.
`record(target, run)` captures one call's span tree, for timing an apply. Read
packages/trace/mod.ts and the visualize README before changing the recording
lifecycle.

When this skill is wrong or missing something, fix it in the same change.
