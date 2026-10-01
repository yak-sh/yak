---
name: effects-and-rules
description: >
  How work that follows a write is done in ~/code/tasks: declared rules inside
  the transaction, effects after the commit (the pool, start-up work, sweeps,
  retries, leases), observers in one process, and which process runs what
  (roles, services, the effects thread). Use it whenever you add or change an
  effect, a rule, a start-up job, a sweep, a lease or duty, a plugin's service
  or a role, write an `/effects` or `/rules` facet or an `effect: true` or
  `rule: true` entry in a vocab.json, or debug something that runs after a
  write: a run that loops, never fires, fires too often, retries forever, or
  runs in the wrong process. Where a facet's code lives and how a plugin is
  wired is `packages-and-plugins`; a one-time fix of stored rows is
  `data-migration`.
scope: tasks-v2
volatility: stable
---

# Effects, rules and roles

Behavior in this graph is declared, not hand-rolled (M-39551): what a write
means is a rule, what follows a write is an effect, and which process does each
is a role. Three mechanisms, chosen by when the work must happen and who must
know about it.

| | runs | can refuse the write | where it's declared |
| --- | --- | --- | --- |
| **rule** | inside the transaction, every door | yes | `rule: true` in vocab.json, or a plugin's `/rules` |
| **effect** | after the commit, in the pool | no | `effect: true` in vocab.json; code in `/effects` |
| **observer** | after this process's own commits | no | at runtime (`created`, `changed`, `on`) |

Pick by the question: must the data be consistent the moment the write lands
(a rule)? Does it reach outside the graph, take time, or call a model (an
effect)? Does only this process care, like a view refreshing (an observer)?

## Rules

A declared rule is a match with write clauses and no code
(packages/graph/README.md, "A rule with no code at all"):
`.product, +!shelf, +shelf.aisle=Z`. Its writes join the pending change and get
admission, stamps and the journal like the caller's own. What it creates gets an
id derived from the rule and the match, so every evaluation, on any process or
page, names the same entity.

- It fires once per rule and binding in one apply; a second match refuses the
  transaction. Write the match so its own output stops it matching (`+!shelf`).
- Rules need the storage's `Tx.bindings`; @yaks/sqlite and @yaks/ram both have
  it, D1 doesn't yet (T-58998).
- Rules run alphabetically, adjusted by `before`.
- There is no refusal clause yet (T-58997): a validation rule refuses by writing
  a value the vocabulary rejects. Say so in its description.
- **In the page's graph** (packages/client/README.md, "Rules"): a rule whose
  writes are all `sync: none` is the page's own and never runs on a server. A
  server rule runs on the page only when declared `optimistic: true`; it may add
  or refuse, and whether it holds on the page's partial data is its author's
  call. The server's answer replaces what it added; a server refusal undoes the
  write with everything its rules added. UX components declare no rules
  (D-58967).

## Effects

Declared in vocab.json with its triggers (`created`, `changed` with a component
or `comp.prop`, `removed`, `match`), its code registered under the same name
with `handle` (packages/effects/README.md). With the `effect` component loaded,
a commit writes each run it owes as an `effect` row in the same transaction, so
a crash can't lose one, and any process serving the effects role claims and
runs it.

What to get right:

- **A trigger is broad.** `created: ['completed']` fires for every entity that
  ever gains `completed`, whoever wrote it. Narrow it with `active: '<query>'`
  or a `match`. An effect row itself owes no run (e92dbe49e), so the pool's own
  bookkeeping can't feed a loop; your handler's writes still can, up to the
  generation `depth` (default 2).
- **Not exactly-once.** A run interrupted mid-way runs again. A handler that
  reaches an external system (mail, a payment, a provider) either makes the
  second run harmless itself or declares `idempotent: false`, and is then left
  failed instead.
- **A run reads the present.** It rebuilds its event from the target's current
  state; a value the handler needs as it was at the time, it stores itself.
- **Failures are classified, not relabelled.** `tries` (default three) with
  backoff, then `failed` with its error. A failure that is final (a usage
  limit, a refusal) must stay final: relabelling it as an interruption made a
  run retry forever (d92933dc1).
- **Start-up work is `start: true`.** It is owed once when a process starts
  working the pool, by that process, for the code it has; a CLI command opening
  the graph owes nothing (43b4d4e26). Keep its no-change case cheap: compare a
  stored hash before diffing (749273e48, `_vocab{hash}`).
- **`sweep`** is a query whose matches are owed a run again whenever a worker
  starts: for work a commit never wrote down.
- **Bound work by rows, not time** inside a Worker: the clock doesn't move
  while code runs.
- **A failure is seen** (M-37965): the pool reports it, and `yak effect check`
  lists failed and overdue runs.

A **lease** (`holding`, `take`, packages/effects lease.ts) is for a duty exactly
one process should run, like a poll; the effect pool needs none.

## Roles: which process runs what

A plugin says what it contributes, one facet per subpath (`/vocab`, `/rules`,
`/tools`, `/effects`, `/service`, `/routes`, `/views`, …), and never where it
runs (M-39540). A process serves roles and imports only their facets
(`ROLES` and `compose()` in packages/cli/host.ts):

- `graph` (vocab, rules, tools) is in every process that opens the file;
- `effects` is a pool: any number of processes may work it at once;
- `web` and each plugin's service (named by its package) are singletons.

`yak serve` serves `web` and starts the effects and service roles in a thread
of its own; a `yak` command serves `graph` only (`rolesOf` in
packages/cli/local.ts). Each process records its roles in `process{roles}`, so
`.process.roles` shows who serves what.

## Debugging after a write

- `yak effect check`: failed and overdue runs.
- `yak graph query '.effect.state=failed'` and `effect.error`, `effect.touched`
  (every component the commit moved on that entity), `effect.attempts`.
- A loop: look at what the handler writes, and whether that write matches its
  own trigger or another effect's.
- Never fires: is the code registered in a process that serves `effects`, and
  does the trigger read a component the write actually moved?
- A store or service that fails at start must keep serving and retry
  (1fa525581), never cache the failure until the next deploy.

When this skill is wrong or missing something, fix it in the same change.
