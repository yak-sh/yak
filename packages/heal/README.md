# @yaks/heal

`@yaks/heal` reports actionable exceptions through the host's reporter and
starts agent sessions for bug tasks already in the graph.

```sh
deno add jsr:@yaks/heal
```

An `exception` (@yaks/tools) on any entity is the trigger. `refusal` is a
deliberate no and never reports anything. Legacy `error` outcomes also never
report anything.

## Stored data

- `bug{fault, hits, last}` ([`@yaks/tracker`](../tracker/README.md)) groups
  occurrences in the tracker graph. Heal's fixer machinery expects a bug task
  already filed in its graph.
- `fixer{bug}` sits on a session started to fix that task.
- `nofix{}` sits on a project. Bugs filed under it start no fixer; on the home
  project (config `project`), no bug starts one.

`fixer.bug` is written by the host only.

## What happens

The `@yaks/heal/effects` handlers, after each commit:

1. `created(exception)`: read `exception.value`, `exception.message`, or
   `content.body`, and skip known transients (timeouts, reset connections and
   provider 5xx responses). `exception_report` calls `host.report` with the
   original exception type and stack. Context names the exception entity and its
   kind, its session or process when present, and its caught time and build
   version. The occurrence id derives from the exception entity's eid, so effect
   redelivery reaches tracker intake as the same occurrence.

   The [box host](../cli/README.md) supplies the reporter, which fans out to
   Sentry and the tracker spool through `@yaks/tracker/report`'s `coalesce`.
   Heal opens no tracker database or spool and writes no bug task when an
   exception arrives.
2. `created(bug)`: start a fixer. This is the @yaks/spawn request (a session,
   and an entry with `using{provider, model, effort}`), plus a `claim` on the
   bug for that session and `fixer{bug}` on the session, in one transaction.
   Four gates come first, and a gate saying no leaves the task filed:
   - off: no `provider` configured, or the host runs without duties;
   - muted: `nofix` on the bug's project or on the home project;
   - at cap: `cap` fixers running: no `exit` yet, and a process or a start under
     five minutes old;
   - cooling down: a fixer for the same fault started within `cooldown`.

   A bug a gate held back is tried again by the `bug` registration's sweep when
   the host starts. A bug never gets a second fixer.

## Config

Exception reporting needs the host's `report` capability and `@yaks/tools`'
exception vocabulary. The fixer machinery also needs `@yaks/tracker`'s `bug`
vocabulary wherever bug tasks are filed. Heal declares `fixer` and `nofix` and
contributes both effect handlers.

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
key is optional; with no `provider`, exceptions are reported and no fixer
starts.

## Exports

The root export is `healDoc` and the pure `actionable` filter.
`@yaks/heal/vocab` exports `docs` for plugin loaders, and `@yaks/heal/effects`
exports `effects`.

`@yaks/fts` has a `heal()` that rebuilds a full-text index. That is a different
act.
