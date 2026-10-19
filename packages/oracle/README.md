# @yaks/oracle

Evidence-grown oracle trees, bounded questions and conversations kept as graph
entities.

An **oracle** is a session about one topic, with an assigned domain, a public
advertisement and immutable revisions of its retained context. A `topic{name}`
entity can carry that oracle: its topic title names the subject; its
advertisement explains what it can answer. A **tree** names a root oracle;
`oracle_child` edges point from a child to its parent. A **dialogue** is an
ordinary session transcript between a caller session and an oracle session.

```ts
import { treeBundles } from '@yaks/oracle'
import { equal } from '@yaks/testing'

let rows = await treeBundles('tree', 'Colors', {
  root: 'root',
  nodes: [{
    id: 'root',
    domain: 'Colors',
    children: [],
    tools: [],
    evidence: [],
    revisions: [],
  }],
})
equal(rows[0].doc?.title, 'Colors')
```

## Exports

| Export       | Offers                                                             |
| ------------ | ------------------------------------------------------------------ |
| `.`          | `growOracleTree`, `graphTree`, `treeBundles`, `loadTree` and types |
| `./evidence` | `ownerWords`, the strictly earlier verbatim projection             |
| `./vocab`    | Oracle component declarations                                      |
| `./tools`    | `oracle_query`, native receiving conversations                     |
| `./views`    | Tree and oracle renderers for browser and terminal hosts           |

`graphTree(graph, { tree, title, rows, cutoff, model, limits })` prepares a tree
offline. Pass `retained: true` to load it from the graph without growth.
`query`, `question` and `converse` persist completed and failed exchanges;
`save` commits the working snapshot. A supplied `caller` is an existing session
id; otherwise the tree gets a dedicated caller session. Node keys, revisions,
frozen evidence and child order survive a save/load cycle. Model adapters and
billing remain the caller's responsibility.

`tree.question()` shares a six-call budget across follow-ups and descendants.
Ordinary answers cannot branch or revise; structural work is explicit offline
maintenance. Every receiving dialogue has a separate transcript. Tree browsing
subscribes to its nodes, edges and dialogues, rather than the whole graph.

The graph must compose kernel, doc, edge, session, tools and oracle vocabulary.
The tree and oracle pages offer **Ask this oracle**. Sending creates a native
receiving fork of a frozen retained-context snapshot, using the configured
OpenAI model and the harness's existing connection. Each question starts a
separate dialogue; open it in the conversation list to read and continue in the
shared session interface. The source oracle stays stopped. Opening a page makes
no model request.

`oracle_query({oracle, text, model?})` is the same tool behind that control. It
returns the native dialogue immediately. An optional model names an existing
model row; otherwise a calling native session's model, or the configured OpenAI
default, is reused. The native runner executes the dialogue; the offline tree
engine remains available for retained experiment replay.
