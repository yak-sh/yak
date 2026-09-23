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
implementation, tools, or background jobs.

## Example

```ts
import { goalDoc } from '@yaks/goal'
import { docDoc } from '@yaks/doc'
import { loadVocab } from '@yaks/vocab'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'

const vocab = loadVocab([docDoc, goalDoc])
const g = graph({ vocab, storage: ram(vocab) })
await g.apply([{
  entity: { eid: 'response-time' },
  goal: {},
  doc: { title: 'Keep response times low' },
}])
console.log(await g.read('.goal'))
```

An entity is a record identified by `entity.eid`; its components are the named
objects beside `entity`. Here, `goal` classifies the record and `doc` stores its
text. RAM storage keeps this example in memory only. Add your project vocabulary
before writing `goal.scope`.

## Compatibility

Deno, Node and browsers. The package exports JSON declarations and makes no
runtime calls.
