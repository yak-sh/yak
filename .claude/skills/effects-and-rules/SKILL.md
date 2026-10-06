---
name: effects-and-rules
description: >
  How work after a write is done in ~/code/tasks: transactional rules,
  post-commit effects (the pool, start-up work, sweeps, retries, leases),
  process-local observers, roles, services and independent workers. Use it
  when changing an effect, rule, start-up job, sweep, lease, duty, service
  or role, an `/effects` or `/graph` facet or `effect: true` / `rule: true`
  vocab entry, or debugging work after a write: loops, never fires, fires
  too often, retries forever, or runs in the wrong process. Reading composed
  anatomy and causal activity is `platform-visualize`, not changing behavior.
  Facet placement and plugin wiring are `packages-and-plugins`; one-time
  stored-row fixes are `data-migration`; turning query matches into model
  or tool outputs is `builders-and-builds`.
---

# Effects, rules and roles

A write has landed, or is landing, and something has to follow from it: a
value kept consistent, a mail sent, a model asked, a view refreshed. Here that
something is declared, not hand-rolled. The owner, verbatim (M-39551): "i'm
expecting basically all behavior to be defined as effects, rules, comps, etc."
And, finding a whole transcript run as one looping effect (`session_run` still
is, until D-61816 and T-61786 make each step its own run): "a session is just a
log of data. the rules determine how it changes, including appending tool calls
or other requests. and the effects handle generically anything in the graph
that needs doing. there is no "running a session". the session running is the
result of a number of different mechanisms happening all over the platform".

So behavior is something the graph does, not something a process runs. A rule
is the grammar of a write: what it means, settled in the same breath it's
written, and able to refuse a sentence that doesn't parse. An effect is an
errand the write leaves behind, written down on the same page so a crash can't
lose it, and picked up by whoever is free. An observer is someone in the room
who happens to notice.

| | runs | can refuse the write | where it's declared |
| --- | --- | --- | --- |
| **rule** | inside the transaction, every door | yes | `rule: true` in vocab.json, or a plugin's `/graph` |
| **effect** | after the commit, in the pool | no | `effect: true` in vocab.json; code in `/effects` |
| **observer** | after this process's own commits | no | at runtime (`created`, `changed`, `on`) |

The choice is a question about the work. Must the data be consistent the
moment the write lands? A rule. Does it reach outside the graph, take time, or
call a model? An effect. Does only this process care, like a view refreshing?
An observer. What makes us wince is the fourth answer: a loop in one process
doing by hand what rules and effects would do in the open. Making something for
each match of a query, with a model or a tool, already has its effect: a
builder (`builders-and-builds`).

## Rules

A declared rule is a match with write clauses and no code
(packages/graph/README.md, "A rule with no code at all"):
`.product, +!shelf, +shelf.aisle=Z`, in the grammar `query-grammar` teaches.
Its writes join the pending batch and get admission, stamps and the journal
like the caller's own (`graph-reads-and-writes`). What it creates gets an id
derived from the rule and the match, so every evaluation, on any process or
page, names the same entity.

A rule fires once per rule and binding in one apply, and a second match
refuses the transaction. So a good rule quenches itself, like a thermostat:
its own output is what stops it matching (`+!shelf` above).

- Rules need the storage's `Tx.bindings`; @yaks/sqlite and @yaks/ram have it,
  D1 doesn't yet (T-58998).
- They run alphabetically, adjusted by `before`.
- There's no refusal clause yet (T-58997). A validation rule refuses by writing
  a value the vocabulary rejects, which nobody reading it would guess, so its
  description says so.
- **In the page's graph** (packages/client/README.md, "Rules"): a rule whose
  writes are all `sync: none` is the page's own and never runs on a server. A
  server rule runs on the page only when declared `optimistic: true`; it may
  add or refuse, and whether it holds on the page's partial data is its
  author's call. The server's answer replaces what it added; a server refusal
  undoes the write with everything its rules added. UX components declare no
  rules (D-58967).

## Effects

An effect is declared in vocab.json with its triggers (`created`, `changed`
with a component or `comp.prop`, `removed`, `match`), and its code is
registered under the same name with `handle` (packages/effects/README.md, the
reference for everything below). With the `effect` component loaded, a commit
writes runs for its registered handlers as `effect` rows in the same
transaction, so a crash can't lose one, and any process serving the effects
role claims and runs it.

A declared effect with no registered handler owes no row. Composition registers
only the code the process has, including conditional handlers, and supplies no
no-op for a missing one; a store's alarm ignores pending rows for handlers it
doesn't compose.

What any errand runner that can't lose work lives with:

- **A trigger is broad.** `created: ['completed']` fires for every entity that
  ever gains `completed`, whoever wrote it. `active: '<query>'` or a `match`
  narrows it to the cases meant. An effect row owes no run itself
  (e92dbe49e), so the pool's bookkeeping can't feed a loop; a handler's own
  writes still can, up to the generation `depth` (default 2).
- **Durable means at least once.** Writing the run with the commit is what
  makes it crash-proof, and the price is that a run interrupted midway runs
  again. A handler that reaches outside (mail, a payment, a provider) makes
  the second run harmless, or declares `idempotent: false` and is left failed
  rather than repeated. `attempt.retry(body)` retries a local completion
  without replaying the external part.
- **A run reads the present.** It rebuilds its event from the target's current
  state. A value it needs as it was at the time, it stores itself.
- **A failure keeps its kind.** `tries` (default three) with backoff (1s,
  doubling, at most 5 min), then `failed` with its error. A final no (a usage
  limit, a refusal) stays final: relabelled as an interruption, one retried
  forever (d92933dc1). One that may pass throws an error carrying `retry` (a
  `ModelError`'s), which the pool reports only once no try follows, waiting
  at least `retry.after` ms. The handler's fourth argument, `Attempt`, says
  whether this is the `last()` try, and `progressed()` gives a long run that
  got somewhere its tries back (`session_run` calls it after each reply). The
  backoff is the pool's, so a handler carries none of its own.
- **Start-up work is `start: true`.** It's owed once when a process starts
  working the pool, by that process, for the code it has; a CLI command
  opening the graph owes nothing (43b4d4e26). Rows that need fixing once are
  a migration (`data-migration`), not start-up work. Most starts change nothing, so
  that case wants to be cheap: compare a stored hash before diffing
  (749273e48, `_vocab{hash}`).
- **A `sweep`** is a query whose matches are owed a run again whenever a worker
  starts, for work no commit wrote down. The pool selects identities, not
  projected target components, and the handler reads the present target when
  it runs; projecting targets there evaluated every matched session's computed
  status and cost (T-65228).
- **In a Worker, work is bounded by rows,** since the clock stands still while
  code runs (`yaks-app`).
- **A failure is seen** (M-37965): the pool reports it, and `yak effect check`
  lists failed and overdue runs.

A **lease** (`holding`, `take` in packages/effects/lease.ts) is for a duty
exactly one process should run, like a poll. The effect pool needs none.

## Roles: which process runs what

A plugin says what it contributes, one facet per subpath (`/vocab`, `/graph`,
`/tools`, `/effects`, `/service`, `/routes`, `/views`, …; giving it them is
`packages-and-plugins`), and never where it runs. Where is the process's
business: it serves roles, and imports only their facets. The owner, verbatim
(M-39540): "facets are about where things run, not when." Think of hats rather
than buildings: one process can wear several, and any number can wear the
effects hat at once. `ROLES` and `compose()` are in
packages/cli/host.ts, and packages/cli/README.md is the reference.

- `graph` (`./vocab`, `./graph`, `./tools`) is in every process that opens the
  file.
- `effects` is a pool: any number of processes may work it at once.
- `web` and each plugin's service are singletons; a service is named by its
  package and runs under a lease of that name.

`yak serve` serves `web` only. When no live process serves a duty role, it
starts an independent `yak work --roles <missing>` process, not a duty thread.
Installed systemd runs `yak.service` with `--no-duties` and independent
`yak-work@` workers. A passing `yak` command serves `graph` and its own tool's
roles; only over a graph that keeps no pool does it run effects where they
were committed (`rolesOf` in packages/cli/local.ts). Each process records its
roles in `process{roles}`, so `.process.roles` shows who serves what.

`yak restart` is the agent's restart door: a new worker is ready first, then
the old workers' graceful drain and the web restart are enqueued. It doesn't
wait in a shell for shutdown.

Every process winds down one way (`@yaks/process/wind`). The first interrupt (a
signal, or Ctrl-C in a terminal app) stops its hosts, so the pool claims
nothing more, a transcript starts no new step and a server takes no new
request, and the process waits for every run it started, with no deadline of
its own, logging what it waits on. A second interrupt forces shutdown and may
cut off a run or an external action; it isn't guaranteed lossless. Recorded
work left owed is the next worker's.

## Debugging after a write

`platform-visualize` traces what ran after a write. The runs themselves:

- `yak effect check`: failed and overdue runs.
- `yak graph query '.effect.state=failed'`, with `effect.error`,
  `effect.touched` (every component the commit moved on that entity) and
  `effect.attempts`.
- A loop: what does the handler write, and does that write match its own
  trigger or another effect's?
- Never fires: is the code registered in a process that serves `effects`, and
  does the trigger read a component the write moved?
- A store or service that fails at start keeps serving and tries again
  (1fa525581). Production will break, and the system is built to come back on
  its own (M-37965) rather than hold a failure until the next deploy.

When this skill is wrong or missing something, fix it in the same change.
