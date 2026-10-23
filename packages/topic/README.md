# @yaks/topic

A knowledge graph of topics. A topic is a subject, such as "data model" or
"testing", and a project is its own topic. Some topics are world knowledge and
some belong to a project; together they form a tree you can open, browse and
read, everything known about a subject is held under it, and every claim in it
leads back to who said it.

A topic is an entity (a record identified by `entity.eid`) carrying:

- `topic{name, scope}`: `name` is its title in lowercase with single spaces, and
  no two topics share one, so a name said twice is one topic. It is a name, not
  an identity: the eid is the entity's own, so any entity may wear `topic`, and
  a project does, to be its own topic. `scope` is the project it holds for,
  absent for a topic that holds everywhere.
- `doc{title, body}` ([@yaks/doc](../doc)), the **cover**: its title and a line
  or two saying what belongs under it, what a reader sees in a list and decides
  by.
- `content{body}` ([@yaks/tools](../tools)), the **contents**: what is
  understood about the subject, written as one document.

Its edges are relations that already exist, never new ones:

| Relation              | Package                   | Means                                                                |
| --------------------- | ------------------------- | -------------------------------------------------------------------- |
| `contains`            | [@yaks/task](../task)     | what it holds: a subtopic, or any other entity (a memory, a package) |
| `requires`            | [@yaks/task](../task)     | a topic to understand first                                          |
| `reads`, `references` | [@yaks/kernel](../kernel) | related things, listed but not held                                  |
| `cites{hash}`         | [@yaks/kernel](../kernel) | its sources: verbatim words, sessions, entries, memories             |

Beliefs ([@yaks/memory](../memory)) are about topics (`belief{scope, about}`): a
memory marks what was said, a belief concludes something from memories and cites
them, and a topic's contents are written from its beliefs and cite them. So a
reader goes cover, contents, sources, and down the tree.

## A topic as a session's context

A session can be **opened on a topic**: this package adds `topic` to
[@yaks/session](../session)'s `session`, the topic it was opened on, beside the
persona it wears. Such a session wears one persona, the **oracle** (`ORACLE`, a
persona at an eid every graph derives alike), unless whoever opened it named
another, and it starts from the topic's tree, compiled into one markdown
document after the persona's text. No persona is made or kept per topic: the
topic tree is the one tree to maintain, and the oracle is what every topic
session hears.

The tree a topic compiles to (`gather` reads it, `compile` writes it):

- where it sits: each topic containing it, up to the roots, by its cover;
- the topic: its cover, its contents, and the `$was` token of its contents, so a
  session rewrites them without reading them again;
- what it holds, in full, in edge order, as a persona includes what it contains.
  A body over `CUT` characters is cut at a paragraph and names its id for the
  rest, and past `BUDGET` characters in all, the rest are listed;
- below it: its subtopics as an outline, each with its cover and the titles of
  what it holds, `LEVELS` deep;
- what to understand first, what is related and its sources, a line each.

`compile` is pure, so a tree read elsewhere compiles the same way:

```ts
import { compile, cut } from '@yaks/topic'
import { topicDoc } from '@yaks/topic/vocab'
import { sessionDoc } from '@yaks/session/vocab'
import { docDoc } from '@yaks/doc/vocab'
import { loadVocab } from '@yaks/vocab'
import { equal } from '@yaks/testing'

let vocab = loadVocab([docDoc, sessionDoc, topicDoc])
let said = compile(vocab)({
  topic: {
    entity: { eid: 'q1' },
    topic: { name: 'data model' },
    doc: { title: 'Data model', body: 'How data is shaped.' },
  },
  holds: [{ entity: { eid: 'm1' }, doc: { title: 'Ids', body: 'An eid.' } }],
  path: [],
  below: [],
  needs: [],
  related: [],
  sources: [],
})
equal(said.split('\n\n---\n\n').slice(0, 2), [
  '# #q1 Data model\n\nHow data is shaped.\n\n## Contents\n\nNothing is written here yet.',
  '# #m1 Ids\n\nAn eid.\n',
])
equal(cut('one two\n\nthree four', 12), { text: 'one two', left: 12 })
```

Over a graph, `await gather(g)('Q-59416')` reads the tree, or `undefined` where
the id names no topic.

Doors that open one: `yak session new --topic Q-59416 "…"` and `session_new`
with `topic` ([@yaks/harness](../harness)); in a browser, the Ask part of a
topic's page; and `yak topic read Q-59416` prints what such a session is given.

## Install

```sh
deno add jsr:@yaks/topic
```

## Use

```ts
import { fits, named, overlaps } from '@yaks/topic'
import { equal } from '@yaks/testing'

equal(named('  Data   Model '), 'data model')
equal(overlaps('economic market design', 'market design'), true)
equal(overlaps('ui design', 'cover design'), false)
equal(fits('Data Modeling', 'data model'), true)
```

A topic is **found** by what somebody says (`fits`): each word said starts one
of the topic's words (its name's, title's and cover's), as it is typed, or
shares its stem with one, so "data modeling" finds data model and "tests" finds
testing.

## The tools

`@yaks/topic/tools` exports `runs()`, the implementations behind the four tools
`vocab.json` declares (`yak topic find`, `yak topic new`, `yak topic add`,
`yak topic read`, and each over `/mcp`):

```sh
yak topic find model
yak topic find --near '#c625160bfa'
yak topic new testing --body 'what a test checks, and how fast a suite runs'
yak topic new billing --body 'plans, prices and invoices' --scope P-19
yak topic add Q-59416 M-14942 M-59035
yak topic add 'Task Graph' D-130781
yak topic add Q-59416 M-59035 --drop
yak topic read Q-59416
```

`topic read` answers the topic tree compiled from one topic, the context a
session opened on it starts from.

`topic find` answers topics whole: those `said` finds (`fits`), ranked by
meaning to `near` where the server has embeddings, or else in order of name.

`topic new` makes a topic from a name, a cover and an optional scope. One name
is one topic, so it refuses a name that is taken, or whose words hold another
topic's or are held by them ("economic market design" beside "market design"),
and says which topic to use. Whoever makes a topic finds first, so a subject
already named is reused, and the name's unique index refuses the second of two
writers that found nothing at once.

`topic add` puts entities under a topic, a `contains` edge from the topic to
each, where whoever reads the topic finds them: a memory, a design, a skill, a
package, somebody's words, a subtopic. Adding one already there changes nothing,
and `--drop` takes them out. It refuses a topic that is not one, and a topic
holding itself. A project is its own topic, so a project's id or name places
things under it.

## The views

`@yaks/topic/views` draws the topics wherever the browsing app
([@yaks/browse](../browse)) does, in a browser and a terminal alike, as a
library's catalogue: the shelves on one side, the topic opened on the other.

The **shelves** are every topic as a tree: the topics no topic contains at the
top, each over the topics it contains, each level by title (`shelves`, pure).
Over them a field finds a topic by what is typed, narrowing the shelves to the
topics it finds under the topics holding them; Enter opens the first, and Escape
clears it. What is typed there is the person's draft, through the UX host's
`drafts` (@yaks/ux).

The sidebar offers them as **Topics** (`destinations`), at `/?topics`: every
topic with its cover (`Topics.Page`). A topic opens on its page, the `Topic`
tab, beside the shelves, titles only, the topic lit and the shelves holding it
open; stacked, as on a phone, the page comes first. The page alone is its
`Inspect.Page`, and a card's face (`Card.Topic`):

- the head: its title, what contains it, and where it holds (the project its
  scope names, or everywhere), each named from the answer that brought it;
- the cover's words; then a line to ask about it, where the host draws a
  conversation (`Conversation`; browse's chat), whose first message opens a
  session on the topic wearing the oracle; then the contents, as markdown;
- what it contains, what to understand first, what is related and its sources,
  each in edge order;
- the beliefs about it, newest first, and the archived ones on a press, muted;
- the comments on it, with a line to write one, where the host draws a thread
  (`Comments`; @yaks/kernel's in browse), each stamped as its writer's;
- then the facts, links and history any page has.

Whatever it holds or cites is drawn by that entity's own renderer, asked for as
`Topic.List.Tile`: a subtopic as its cover, a belief as what it states
(@yaks/memory), anything else as it reads in any list.

The `Tree` tab draws what a topic contains all the way down, each subtopic's
holdings nested under it. It walks only into topics, draws a topic met again on
its own path without walking it, and links to the rest past `DEPTH` levels.

## Exports

The root exports `topicDoc`, `named` (a title folded to a topic's name), `HOLDS`
(the relation a topic holds things by, `contains`), `overlaps` (whether two
names share a subject by their words), `fits` (whether what was said finds a
topic's words), `about` (a topic's words: name, title and cover), `found` (the
query that reads every topic), `shelves` and `within` (the topics as a tree, and
that tree narrowed to what was said), `gather` and `compile` (a topic's tree as
read, and as the markdown a session opened on it starts from), `cut` (a body cut
at a paragraph), `ORACLE` (the persona a topic session wears), and the constants
`TOPIC`, `FIND`, `TOPICS`, `CUT`, `BUDGET`, `LEVELS`, `LINES` and `GIST`.
`@yaks/topic/vocab` exports `topicDoc` and `docs: [topicDoc]` for schema
loaders. `@yaks/topic/views` exports `inspectViews()`, which loads the shelves,
the page, the tree and the tile; `tabs`, the two tabs a topic wears;
`destinations`, the Topics page the sidebar offers; and `icons`, the glyph it
wears.

## Compatibility

Pure TypeScript with no platform API, so it runs in a browser, on Deno and on
Node. The tools need a configured graph, and `near` a vector index. The views
are Preact components a host mounts through @yaks/inspect's contract.

## License

Apache-2.0
