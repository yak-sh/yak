# @yaks/effects

The mechanism by which a [@yaks/graph](https://jsr.io/@yaks/graph) **does
something** about the data it commits, without tangling that work into the write
path.

## Install

```sh
deno add jsr:@yaks/effects
# or: npx jsr add @yaks/effects
```

## What goes here

A write is settled by the graph's `apply()`. An **effect** is the other half: a
post-commit observer that reacts to committed components — a new `order` row
triggers a receipt, a deleted `session` ends its process. This package ships the
**registry and the runner only**; it defines no concrete effect. A plugin
registers its own effects against the component names it cares about.

Effects are **at-most-once**, reconciled on boot, and fire only **after** the
transaction commits — so they see settled data and can never veto it. An effect
that throws is telemetry, never a rolled-back write. (Rejecting a write is the
precondition phase's job, upstream in `apply()`.)

## Where it sits

It consumes the committed-change feed that
[@yaks/journal](https://jsr.io/@yaks/journal) produces, and is the seam plugins
such as [@yaks/session](https://jsr.io/@yaks/session) use to act on their own
components.

## The interface

It exports the shape it satisfies: `Effect`, `Event`, `Kind`, and a `Registry`
seam (`add`, `emit`). The implementation lands with the package.
