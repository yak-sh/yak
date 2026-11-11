# @yaks/goal

Defines graph components for long-term objectives and the relationships
recording which work contributes to them. Unlike a task, a goal has no status or
completion operation; query its `satisfies` relationships to see progress.

## Stored data and exports

- `goal{scope}` marks an objective. Optional `scope` references its project;
  omitting it makes the objective unscoped.
- `satisfies{}` is a relationship tag. On an entity with `edge{from, to}`, it
  means the work at `from` contributed to the goal at `to`. Load
  [@yaks/edge](../edge) to create and query these relationships.

The root import exports `goalDoc`, a JSON Schema document. `@yaks/goal/vocab`
also exports `docs: [goalDoc]` for plugin loaders. This package has no storage
implementation or duties.

## Tools

`@yaks/goal/tools` exports `runs()`, the implementations of the tools
./vocab.json declares. Each returns bundles for its host to apply.

- `goal_new{title, body, scope, satisfied_by}` sets a goal. Each id in
  `satisfied_by` gets a `satisfies` link from that work to the goal.
- `goal_list{query, limit}` returns whole goals, narrowed by `.goal`. Without a
  query it returns every goal, since none is ever finished.
- `goal_update{goal, title, body, scope, satisfied_by}` patches what it names
  (`null` clears) and links more work.

The work that served a goal is `.satisfies&.edge.to=<goal>`.

## Example

```ts
import { goalDoc } from '@yaks/goal'
import { docDoc } from '@yaks/doc'
import { loadVocab, pick } from '@yaks/vocab'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { equal } from '@yaks/testing'

const vocab = loadVocab([docDoc, pick(goalDoc, ['goal'])])
const storage = ram(vocab)
const g = graph({ vocab, storage })
g.apply([{
  entity: { eid: 'response-time' },
  goal: {},
  doc: { title: 'Keep response times low' },
}])
equal(storage.read('.goal'), [{
  entity: { eid: 'response-time' },
  goal: {},
  doc: { title: 'Keep response times low' },
}])
```

An entity is a record identified by `entity.eid`; its components are the named
objects beside `entity`. Here, `goal` classifies the record and `doc` stores its
text. RAM storage keeps this example in memory only. Add your project vocabulary
before writing `goal.scope`.

## Compatibility

Deno, Node and browsers. The tools make no runtime calls beyond the graph they
are handed.
