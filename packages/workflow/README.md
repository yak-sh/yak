# @yaks/workflow

A **step** is a rule stored as a row: `step{match, write, when}`. For each
binding of its `match` (a [query](../query/README.md#multi-entity-matches)), it
writes `write`, a list of bundles with its variables filled in. A **workflow**
(`workflow{}` with a `doc{title, body}`) `contains` its steps. A **case**
(`workflow_case{workflow, for}`) is one item moving through a workflow, and
every row a step creates for a case carries `made{case, step, binding}`. The
component is `workflow_case` because @yaks/trial declares `case`; it becomes
`case` once two packages may declare one label.

```sh
deno add jsr:@yaks/workflow
```

| Import                   | Exports                                                                                                                                                                                         |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@yaks/workflow`         | `workflows`, `handlers`, `rerun`, `bindingKey`, `steps`, `Step`, `DEPTH`, `CASE`, `DUE`, `RUN`, `FIRE`; `fill`, `writes`; `feeds`, `needs`; `flow`, `open`, `named`; `outdated`; the vocabulary |
| `@yaks/workflow/vocab`   | `workflowDoc`, `docs`, `description`                                                                                                                                                            |
| `@yaks/workflow/graph`   | `plugins()`: the step runner                                                                                                                                                                    |
| `@yaks/workflow/effects` | `effects(host)`: `step_run` and `step_fire`, the runs the step runner owes                                                                                                                      |
| `@yaks/workflow/views`   | `inspectViews`, `tabs`, `destinations`: a workflow's page in browse, in a browser and a terminal                                                                                                |

## A step

```json
{
  "step": {
    "match": "$o .order",
    "write": [
      {
        "entity": { "eid": "$c" },
        "call": { "name": "pack", "args": { "order": "$o" } }
      }
    ],
    "when": "commit"
  }
}
```

`fill(write, vars)` fills a template for one binding: a string `$name` the match
bound is replaced by its value at any depth, and an entity eid `$name` it did
not bind is a fresh entity, one per binding.

When it runs:

- `when: 'write'` runs inside the write that made it match, in the `rules`
  phase, anchored to that batch. What it writes joins the batch and the steps
  are asked again, so one step can feed the next in one write. Each binding runs
  once in a write.
- `when: 'commit'`, the default, runs after that write commits, as a write of
  its own signed by the same actor. The write that matched owes it in its own
  transaction: a `step_due{step, binding, by, via, depth}` for each binding,
  which owes the `step_run` effect ([@yaks/effects](../effects)), so the pool
  runs it with its retries, and a crash or restart never drops it. The run asks
  the match again anchored to the binding's entities, so it acts on the present,
  and deletes its `step_due` in the same write, so a run repeated after a crash
  finds nothing owed. A chain of these deeper than `DEPTH` (32) is refused as a
  step whose output keeps matching it.
- A step carrying a `wake` or a `watch` ([@yaks/wake](../wake)) runs when the
  wake fires: the firing writes `fired` on the step, which owes the `step_fire`
  effect, and the step's match is asked of the whole graph, written as the
  step's writer.

A step calls out by writing a row: `call{to, args}` for a tool
([@yaks/tools](../tools)), with `using{…}` for a model, and whoever answers the
row is the runner. The next step matches the answer (`result.call=$c`). A
person's step writes any task kind, such as a task filed to them, and the next
step matches its `completed`.

## Cases and `made`

A step a workflow contains acts for a case: the case one of the matched entities
was made for in that workflow, else a new one for the first matched entity, its
eid derived from the workflow and that item, so a rematch finds it. It runs at
most once per case for what its match bound: `bindingKey(binding)`, a short key
of the matched entities, the variables and the brackets' members. Touching a row
it read starts nothing; changing a value it bound runs it again for that case,
so an edit reruns only the steps that read what changed. It stamps
`made{case, step, binding}` on each row it creates. A bare step writes no case
and no `made`; like a declared rule, its own output must stop it matching.

## The map

`feeds(steps, vocab?)` says which step feeds which, computed from the steps so
it cannot drift: one feeds another when it writes a component the other's match
needs present, or one a reference the match follows points at, or when the
other's match names it by eid. A step's `requires` (the steps it waits for) adds
an order the data does not show. `needs(match, vocab?)` is the half that reads a
match.

## Editing a step

Editing a step changes what happens next, never what was made.
`outdated(graph, step)` answers the rows the step made before its last edit,
read from the journal ([@yaks/journal](../journal)'s `_change` and `_tx`), with
no fingerprint stored on them. `rerun(graph, step, cases)` runs the step again
for the cases chosen, whatever it made for them before.

## A workflow's page

`flow(rows, vocab?)` reads a workflow whole, pure: its steps in stages (the
first those nothing feeds, each later one those whose feeders stand before;
steps feeding each other in a loop make a last stage), and each case: what each
step made for it, which of those rows are outdated, the steps it stands at, the
open calls (no `result` names them) and tasks (not `completed` or `cancelled`)
holding it, and whether it is done. A case stands at a step that made something
for it and that no step it reached follows, or whose call or task for it is
open; it is done when nothing holds it and nothing follows. Each step counts the
cases standing at it not done, the cases it made rows for and its outdated rows.

The `/views` facet draws it in [@yaks/browse](../browse): the `Workflow` tab a
workflow opens on, the same page wherever one is asked for (`Inspect.Page`), and
the sidebar's Workflows. The page asks for the steps the workflow `contains`,
their `requires` edges, its cases, the rows made for them and the results
answering their calls, and reads the journal for what is outdated. A row a step
made is drawn by its own renderer, asked for as
`Workflow.Inspect.Reference.Inline`, so a task reads as a task and a call as a
call, and a task filed to someone says who.

It replaces an app's Workflow tab on yaks.app (packages/platform/app-made.ts
`runs`, drawn from @yaks/builders `workflow`) once app workflows are steps.
