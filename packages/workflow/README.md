# @yaks/workflow

A **step** is a rule stored as a row: `step{match, write, when}`. For each
binding of its `match` (a [query](../query/README.md#multi-entity-matches)), it
writes `write`, a list of bundles with its variables filled in. A **workflow**
(`workflow{}` with a `doc{title, body}`) `contains` its steps. A **case**
(`case{workflow, for}`) is one item moving through a workflow, and every row a
step creates for a case carries `made{case, step}`.

```sh
deno add jsr:@yaks/workflow
```

| Import                 | Exports                                                                                                        |
| ---------------------- | -------------------------------------------------------------------------------------------------------------- |
| `@yaks/workflow`       | `workflows`, `rerun`, `steps`, `Step`, `DEPTH`; `fill`, `writes`; `feeds`, `needs`; `outdated`; the vocabulary |
| `@yaks/workflow/vocab` | `workflowDoc`, `docs`, `description`                                                                           |
| `@yaks/workflow/graph` | `plugins()`: the step runner                                                                                   |

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
- `when: 'commit'`, the default, runs after that write commits, anchored to it,
  as a write of its own signed by the same actor. A chain of these deeper than
  `DEPTH` (32) is refused as a step whose output keeps matching it. It runs in
  the process that committed, not through the effect pool, so a crash between
  the commit and the step loses that run; `rerun` makes it.
- A step carrying a `wake` or a `watch` ([@yaks/wake](../wake)) runs when the
  wake fires, its match asked of the whole graph, written as the step's writer.

A step calls out by writing a row: `call{to, args}` for a tool
([@yaks/tools](../tools)), with `using{…}` for a model, and whoever answers the
row is the runner. The next step matches the answer (`result.call=$c`). A
person's step writes any task kind, such as a task filed to them, and the next
step matches its `completed`.

## Cases and `made`

A step a workflow contains acts for a case: the case one of the matched entities
was made for in that workflow, else a new one for the first matched entity, its
eid derived from the workflow and that item, so a rematch finds it. It runs at
most once per case, and stamps `made{case, step}` on each row it creates. A bare
step writes no case and no `made`; like a declared rule, its own output must
stop it matching.

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
