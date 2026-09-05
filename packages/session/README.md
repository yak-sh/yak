# @yaks/session

The **session** and **claim** component domain for a
[@yaks/graph](https://jsr.io/@yaks/graph), and the conflict audit that guards a
claim.

## Install

```sh
deno add jsr:@yaks/session
# or: npx jsr add @yaks/session
```

## What goes here

This plugin contributes two components and one rule:

- a **`session`** is an actor's run — an agent or a client working the graph;
- a **`claim`** is that session's lease on any entity, so two workers do not
  silently edit the same thing at once;
- the rule rides the graph's **precondition phase**: when a write targets an
  entity another session holds, the claim _bounces_, and the bounce is recorded
  as a **`conflict`** entity rather than lost — an audit of who collided with
  whom.

Because the lease check is a phase hook, it holds for every write path.

## Where it sits

A domain plugin over [@yaks/graph](https://jsr.io/@yaks/graph). The audit is the
reason a claim is safe to hand out; it uses the same phase machinery every
plugin does, and reacts to committed writes through
[@yaks/effects](https://jsr.io/@yaks/effects).

## The interface

It exports the shape it satisfies: `Session`, `Claim`, `Conflict`, and the
`plugin` factory. The implementation lands with the package.
