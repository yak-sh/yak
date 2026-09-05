# @yaks/wake

A **scheduling** component domain for a
[@yaks/graph](https://jsr.io/@yaks/graph).

## Install

```sh
deno add jsr:@yaks/wake
# or: npx jsr add @yaks/wake
```

## What goes here

This plugin contributes a `wake` component: a promise to revisit an entity at a
time, on an interval, or when a condition next holds. It is how a graph carries
work that should happen later — a reminder, a recurring sweep, a deferred retry
— as data rather than an out-of-band timer.

```ts
import type { Wake } from '@yaks/wake'

let w: Wake = { at: '2026-01-01T09:00:00Z', every: 'daily' }
```

The package owns the component's vocabulary and the wake policy (when a due wake
fires, and how a recurring one reschedules). _Firing_ a wake is an effect a host
arranges through [@yaks/effects](https://jsr.io/@yaks/effects); this plugin says
WHEN, not HOW.

## Where it sits

A domain plugin over [@yaks/graph](https://jsr.io/@yaks/graph).

## The interface

It exports the shape it satisfies: `Wake`, `Every`, and the `plugin` factory.
The implementation lands with the package.
