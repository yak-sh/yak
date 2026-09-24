# @yaks/heal

When something a host did not expect goes wrong, `@yaks/heal` files a task about
it and starts an agent to fix it.

```sh
deno add jsr:@yaks/heal
```

An `exception` (@yaks/tools) on any entity is the trigger. `error` is a failure
the code expected and handled, and never files anything.

## Stored data

- `bug{fault, hits, last}` sits on a task (@yaks/task) filed for a failure.
  `fault` is the key two failures share when they are the same failure: the
  broken entity's kind, the message with its ids, paths, timestamps and numbers
  taken out, and the top frame of the stack. `hits` counts how often it was
  caught while the task was open, and `last` says when.
- `fixer{bug}` sits on a session started to fix that task.
- `nofix{}` sits on a project. Bugs filed under it start no fixer; on the home
  project (config `project`), no bug starts one.

All three properties of `bug`, and `fixer.bug`, are written by the host only.

## What happens

The `@yaks/heal/effects` handlers, after each commit:

1. `created(exception)`: read the message (the `exception.message`, or the
   `content.body` beside it), skip a known transient (a timeout, a reset
   connection, a provider's 5xx), and compute the fault. An open bug with that
   fault gets `hits + 1`, a refreshed recurrence line at the end of its body,
   and an `about` link to the new failure. Otherwise a new task is filed: `doc`,
   `task`, `filed{priority, project}`, `bug`, and an `about` link to the broken
   entity. The project is the broken entity's own, else the project of the task
   its session holds, else the home project.
2. `created(bug)`: start a fixer. This is the @yaks/spawn request (a session,
   and an entry with `using{provider, model, effort}`), plus a `claim` on the
   bug for that session and `fixer{bug}` on the session, in one transaction.
   Four gates come first, and a gate saying no leaves the task filed:
   - off: no `provider` configured, or the host runs without duties;
   - muted: `nofix` on the bug's project or on the home project;
   - at cap: `cap` fixers running: no `exit` yet, and a process or a start under
     five minutes old;
   - cooling down: a fixer for the same fault started within `cooldown`.
3. `created(exit)` on a fixer: its slot is free, so every open bug nobody holds
   is tried again. The `bug` registration's sweep does the same when the host
   starts. A bug never gets a second fixer.

## Config

```json
{
  "use": "@yaks/heal",
  "with": {
    "provider": "codex",
    "model": "gpt-5.6-sol",
    "effort": "high",
    "project": "P-19",
    "cap": 2,
    "cooldown": 1800000
  }
}
```

`provider` and `model` are ids or names. `cooldown` is in milliseconds. Every
key is optional; with no `provider`, bugs are filed and no fixer starts.

## Exports

The root export is `healDoc` and the pure fault functions: `normalize`,
`faultKey`, `actionable`, `severity` and `recurred`. `@yaks/heal/vocab` exports
`docs` for plugin loaders, and `@yaks/heal/effects` exports `effects`.

`@yaks/fts` has a `heal()` that rebuilds a full-text index. That is a different
act.
