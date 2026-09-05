# @yaks/task

A **task** component domain for a [@yaks/graph](https://jsr.io/@yaks/graph).

## Install

```sh
deno add jsr:@yaks/task
# or: npx jsr add @yaks/task
```

## What goes here

This plugin contributes a `task` component — a status, a priority, and an
optional project — that any entity can wear. An entity carrying a `doc` (title
and body) plus a `task` _is_ a to-do item; the same entity can carry other
components too, so a task is never a closed record — it is a facet.

```ts
import type { Task } from '@yaks/task'

let t: Task = { status: 'open', priority: 1, project: 'proj-3' }
```

The package ships the component's vocabulary and the small logic that belongs to
the domain (the status set and its transitions). It plugs into the graph exactly
as any other domain does; storage, querying, and history come from the core and
its adapters, not from here.

## Where it sits

One of the domain plugins over [@yaks/graph](https://jsr.io/@yaks/graph),
alongside [@yaks/session](https://jsr.io/@yaks/session),
[@yaks/wake](https://jsr.io/@yaks/wake), and others. It composes with
[@yaks/edge](https://jsr.io/@yaks/edge) to relate tasks (dependencies, trees).

## The interface

It exports the shape it satisfies: `Task`, `Status`, and the `plugin` factory.
The implementation lands with the package.
