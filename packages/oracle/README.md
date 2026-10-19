# @yaks/oracle

Topic context cultivated by native oracle conversations, with retained
experiment replay.

An **oracle** cultivates the context attached to a **topic**. The topic is an
existing `topic{name}` entity; its `doc{title,body}` names and advertises the
subject. `topic_context{self,parent,children}` points to three distinct
immutable context records: its own working knowledge, what it shares with
parents, and what it shares with children. Each record carries
`prompt{source,revision}` and `content{body}`, with `cites{hash}` edges to
recorded evidence. Saving context creates no session.

Topics use ordinary typed edges. A relation can declare `parent: "from"` or
`parent: "to"`; [@yaks/edge](../edge/README.md#relations) owns that annotation.
An opening admits the topic's self context, its direct parents' children
context, and its direct children's parent context. It never admits a neighbor's
self context or expands a neighbor's assembled prompt. Unclassified links can be
queried but do not share context automatically. The `contains` relation names
its `from` endpoint as the parent.

`oracle_query({oracle, text, model?})` opens an independent native conversation
about a topic. Its prompt freezes the admitted context bytes and source
revisions. Later context edits affect new openings; an existing conversation
keeps what it received. A native caller gets an ordinary delegated session and
can use `wait({children:[sessionId]})` to receive its answer. The configured or
inherited native model and connection are reused. Opening a topic page or saving
context makes no model request.

`oracle_read({oracle})` returns the topic, its context records and the
`$was.topic_context` tokens. `oracle_revise` replaces only the supplied
directions, each with its own body and recorded evidence ids:

```json
{
  "oracle": "<topic eid>",
  "parent": {
    "body": "What parent topics should know.",
    "evidence": ["<source eid>"]
  },
  "was": { "parent": "<token from oracle_read, or null when absent>" }
}
```

The write creates immutable context records and citations, then guards and
updates the topic's pointers in one transaction. A stale token refuses the whole
change. Exact body bytes are preserved. Source text and revision are checked
before admission to a new conversation.

Native conversations can find or create topics, read evidence, revise contexts,
write ordinary typed graph edges, and consult other oracles while answering a
question. The existing OpenAI provider offers hosted web research where
supported; cited research messages remain transcript evidence. This package has
no generic URL fetch tool. Provider capabilities and permissions still apply.

The topic page shows its advertisement, three stored contexts, their evidence,
ordinary relationships and conversations through shared renderers.

## Retained experiment API

The older offline experiment engine remains available for replay. Its oracle
sessions, `oracle_tree{root,evidence}` and `oracle_child{}` snapshots keep their
original identities and conversations. They do not define the native topic
model.

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

| Export       | Offers                                                               |
| ------------ | -------------------------------------------------------------------- |
| `.`          | `growOracleTree`, `graphTree`, `treeBundles`, `loadTree` and types   |
| `./evidence` | `ownerWords`, the strictly earlier verbatim projection               |
| `./vocab`    | Oracle component declarations                                        |
| `./tools`    | `oracle_query`, `oracle_read`, `oracle_revise`, native conversations |
| `./views`    | Tree and oracle renderers for browser and terminal hosts             |

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

The native topic path composes kernel, doc, edge, session, context, tools,
memory and oracle vocabulary. The offline engine keeps its existing vocabulary
requirements and single-parent tree serialization for retained replay.
